"use strict";

(() => {
  if (window.__xhsBloggerCollectorLoaded) return;
  window.__xhsBloggerCollectorLoaded = true;

  const NOTE_UTILS = globalThis.XHS_NOTE_UTILS;

  const PROFILE_PATH_RE = /^\/user\/profile\/[^/?#]+/;
  const NOTE_PATH_RE = /^\/(?:explore|discovery\/item)\/([^/?#]+)/;
  const PROFILE_NOTE_PATH_RE = /^\/user\/profile\/[^/?#]+\/([^/?#]+)/;
  const PANEL_ID = "xhs-blogger-collector-root";
  const PANEL_WIDTH = 392;
  const SCAN_INTERVAL_MS = 1200;
  const MAX_IDLE_ROUNDS = 4;
  const MAX_AUTO_SCROLLS = 220;
  const DETAIL_MIN_SETTLE_MS = 800;
  const NOTE_SEARCH_SETTLE_MS = 600;

  const state = {
    visible: false,
    running: false,
    done: false,
    stopped: false,
    importingFeishu: false,
    capturingDetails: false,
    detailCurrent: 0,
    detailTotal: 0,
    detailRunToken: 0,
    error: "",
    message: "请打开博主主页再开始采集。",
    limit: 300,
    minLikes: 0,
    typeFilter: "全部",
    scrollsUsed: 0,
    sortByLikes: false,
    author: "",
    candidates: [],
    seen: new Set(),
    nextOrder: 1,
  };

  let runToken = 0;
  let rootHost = null;
  let shadow = null;
  let els = {};
  let originalBodyStyles = null;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isProfilePage() {
    return (
      location.hostname === "www.xiaohongshu.com" &&
      PROFILE_PATH_RE.test(location.pathname)
    );
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  }

  function numberValue(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(parsed, max));
  }

  function profileAuthor() {
    const selectors = [
      ".user-name",
      ".username",
      ".profile-name",
      ".user-info .name",
      ".user .name",
      "[class*='user-name']",
      "[class*='userName']",
      "[class*='profile'] [class*='name']",
      "h1",
    ];

    for (const selector of selectors) {
      for (const node of document.querySelectorAll(selector)) {
        if (!isVisible(node)) continue;
        const value = cleanText(node.textContent);
        if (value && value.length <= 60 && !/关注|粉丝|获赞|IP属地|小红书号/.test(value)) {
          return value;
        }
      }
    }

    return cleanText(document.title)
      .replace(/- 小红书$/, "")
      .replace(/小红书$/, "")
      .trim();
  }

  function normalizeNoteUrl(href) {
    if (!href) return "";
    try {
      const url = new URL(href, location.origin);
      if (url.hostname !== "www.xiaohongshu.com") return "";
      const noteMatch = url.pathname.match(NOTE_PATH_RE) || url.pathname.match(PROFILE_NOTE_PATH_RE);
      if (!noteMatch) return "";
      url.hash = "";
      url.pathname = `/explore/${noteMatch[1]}`;
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function noteUrlScore(url) {
    if (!url) return -1;
    try {
      const parsed = new URL(url);
      let score = 0;
      if (parsed.searchParams.has("xsec_token")) score += 10;
      if (parsed.searchParams.has("xsec_source")) score += 5;
      if (parsed.search) score += 1;
      return score;
    } catch (_) {
      return -1;
    }
  }

  function bestNoteUrlFromCard(card, fallbackAnchor) {
    const anchors = [fallbackAnchor, ...card.querySelectorAll("a[href]")].filter(Boolean);
    let best = "";
    let bestScore = -1;

    for (const anchor of anchors) {
      const url = normalizeNoteUrl(anchor.getAttribute("href"));
      const score = noteUrlScore(url);
      if (score > bestScore) {
        best = url;
        bestScore = score;
      }
    }

    return best;
  }

  function cardForAnchor(anchor) {
    return (
      anchor.closest("section") ||
      anchor.closest("article") ||
      anchor.closest(".note-item") ||
      anchor.closest("[class*='note-item']") ||
      anchor.closest("[class*='NoteItem']") ||
      anchor.closest("[class*='card']") ||
      anchor.closest("[class*='Card']") ||
      anchor.closest("[class*='item']") ||
      anchor.parentElement
    );
  }

  function textFromSelector(root, selectors) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      const value = cleanText(node ? node.textContent : "");
      if (value) return value;
    }
    return "";
  }

  function looksLikeLikeText(value) {
    return /^(点赞|赞|喜欢|like)?\s*[\d,.]+(\.\d+)?\s*(万|w|k)?\s*$|^赞$|^点赞$/i.test(
      cleanText(value)
    );
  }

  function titleFromCard(card, anchor) {
    const selectors = [
      ".title",
      ".note-title",
      "[class*='title']",
      "[class*='Title']",
      "[class*='footer'] span",
    ];
    let title = textFromSelector(card, selectors);

    if (!title) {
      title =
        cleanText(anchor.getAttribute("title")) ||
        cleanText(anchor.getAttribute("aria-label"));
    }

    if (!title) {
      const image = card.querySelector("img[alt]");
      title = cleanText(image ? image.getAttribute("alt") : "");
    }

    if (!title) {
      title =
        cleanText(card.textContent)
          .split(" ")
          .map(cleanText)
          .find((line) => line.length > 1 && !looksLikeLikeText(line)) || "";
    }

    return cleanText(title)
      .replace(/\s*(点赞|赞|like)\s*$/i, "")
      .slice(0, 300);
  }

  function parseLikeCount(rawValue) {
    const raw = cleanText(rawValue)
      .replace(/,/g, "")
      .replace(/点赞|赞|喜欢|likes?|人/g, "")
      .trim();
    if (!raw || raw === "-") return null;

    const match = raw.match(/(\d+(?:\.\d+)?)\s*(万|w|k)?/i);
    if (!match) return null;

    const number = Number.parseFloat(match[1]);
    if (!Number.isFinite(number)) return null;

    const unit = (match[2] || "").toLowerCase();
    if (unit === "万" || unit === "w") return Math.round(number * 10000);
    if (unit === "k") return Math.round(number * 1000);
    return Math.round(number);
  }

  function parseLikeElement(node) {
    if (!node) return null;
    const labelled = cleanText(
      [
        node.getAttribute("aria-label"),
        node.getAttribute("data-count"),
        node.getAttribute("data-like-count"),
        node.textContent,
      ].filter(Boolean).join(" ")
    );
    return parseLikeCount(labelled);
  }

  function likeTextFromCard(card) {
    const selectors = [
      ".like-wrapper .count",
      ".like-wrapper",
      "[class*='like'] [class*='count']",
      "[class*='Like'] [class*='count']",
      "[class*='like']",
      "[class*='Like']",
      "[class*='likes']",
      "[class*='Likes']",
    ];

    for (const selector of selectors) {
      for (const node of card.querySelectorAll(selector)) {
        const parsed = parseLikeElement(node);
        if (parsed !== null) {
          return cleanText(node.textContent || node.getAttribute("aria-label") || String(parsed));
        }
      }
    }

    return "";
  }

  function coverFromCard(card) {
    const image = card.querySelector("img");
    if (!image) return "";
    return image.currentSrc || image.src || image.getAttribute("src") || "";
  }

  function noteFormFromCard(card) {
    const text = cleanText(card.textContent);
    const marker = card.querySelector(
      "video, svg[class*='play'], [class*='play'], [class*='Play'], [class*='video'], [class*='Video']"
    );
    if (marker || /视频|播放|▶/.test(text)) return "视频";
    return "图文";
  }

  function filteredRows() {
    return state.candidates.filter((row) => {
      const passLikes = state.minLikes <= 0 || (Number.isFinite(row.likes) && row.likes >= state.minLikes);
      const passType = state.typeFilter === "全部" || row.noteForm === state.typeFilter;
      return passLikes && passType;
    });
  }

  function collectVisibleCards() {
    const author = profileAuthor();
    if (author) state.author = author;

    let added = 0;
    const anchors = [...document.querySelectorAll("a[href]")];

    for (const anchor of anchors) {
      if (state.candidates.length >= state.limit) break;
      const card = cardForAnchor(anchor);
      if (!card || !isVisible(card)) continue;

      const url = bestNoteUrlFromCard(card, anchor);
      if (!url || state.seen.has(url)) continue;

      const title = titleFromCard(card, anchor);
      const likes = parseLikeCount(likeTextFromCard(card));
      const cover = coverFromCard(card);
      const noteForm = noteFormFromCard(card);

      state.seen.add(url);
      state.candidates.push({
        order: state.nextOrder,
        noteId: NOTE_UTILS.noteIdFromUrl(url),
        author: state.author || "",
        title,
        likes: likes === null ? "" : likes,
        noteForm,
        url,
        cover,
        coverUrl: cover,
        content: "",
        detailStatus: "idle",
        detailError: "",
      });
      state.nextOrder += 1;
      added += 1;
    }

    return added;
  }

  function isNearPageBottom() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    const height = Math.max(
      document.body ? document.body.scrollHeight : 0,
      document.documentElement.scrollHeight
    );
    return scrollTop + viewport >= height - 24;
  }

  function applySplitLayout() {
    if (!document.body || originalBodyStyles) return;
    originalBodyStyles = {
      width: document.body.style.width,
      maxWidth: document.body.style.maxWidth,
      paddingRight: document.body.style.paddingRight,
      boxSizing: document.body.style.boxSizing,
      transition: document.body.style.transition,
      overflowX: document.documentElement.style.overflowX,
    };
    document.body.style.setProperty("width", `calc(100% - ${PANEL_WIDTH}px)`, "important");
    document.body.style.setProperty("max-width", `calc(100% - ${PANEL_WIDTH}px)`, "important");
    document.body.style.setProperty("padding-right", "0", "important");
    document.body.style.setProperty("box-sizing", "border-box", "important");
    document.body.style.setProperty("transition", "width 180ms ease, max-width 180ms ease", "important");
    document.documentElement.style.setProperty("overflow-x", "hidden", "important");
  }

  function restoreSplitLayout() {
    if (!document.body || !originalBodyStyles) return;
    document.body.style.width = originalBodyStyles.width;
    document.body.style.maxWidth = originalBodyStyles.maxWidth;
    document.body.style.paddingRight = originalBodyStyles.paddingRight;
    document.body.style.boxSizing = originalBodyStyles.boxSizing;
    document.body.style.transition = originalBodyStyles.transition;
    document.documentElement.style.overflowX = originalBodyStyles.overflowX;
    originalBodyStyles = null;
  }

  function createPanel() {
    if (rootHost) return;

    rootHost = document.getElementById(PANEL_ID);
    if (!rootHost) {
      rootHost = document.createElement("div");
      rootHost.id = PANEL_ID;
      document.documentElement.appendChild(rootHost);
    }
    shadow = rootHost.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          --bg: #f5f5f7;
          --panel: rgba(255, 255, 255, 0.86);
          --panel-solid: #ffffff;
          --ink: #1d1d1f;
          --muted: #6e6e73;
          --line: rgba(60, 60, 67, 0.14);
          --line-strong: rgba(60, 60, 67, 0.22);
          --blue: #007aff;
          --blue-hover: #006ee6;
          --danger: #ff3b30;
          --control: rgba(118, 118, 128, 0.12);
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
        }

        .shell {
          position: fixed;
          top: 0;
          right: 0;
          z-index: 2147483647;
          display: none;
          width: 392px;
          height: 100vh;
          padding: 12px;
          background: var(--bg);
          border-left: 1px solid var(--line);
          box-shadow: -18px 0 48px rgba(0, 0, 0, 0.12);
          color: var(--ink);
          box-sizing: border-box;
        }

        .shell.open {
          display: flex;
          flex-direction: column;
        }

        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 34px;
          padding: 0 2px 10px;
          font-size: 15px;
          font-weight: 650;
          letter-spacing: 0;
        }

        .title {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 0;
          white-space: nowrap;
        }

        .app-mark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          flex: 0 0 auto;
          border-radius: 7px;
          background: linear-gradient(135deg, #f9fcff 0%, #d9f0ff 48%, #f0e7ff 100%);
          box-shadow:
            inset 0 0 0 1px rgba(255, 255, 255, 0.86),
            0 4px 10px rgba(0, 122, 255, 0.22);
          position: relative;
          overflow: hidden;
        }

        .app-mark::before {
          content: "";
          width: 11px;
          height: 14px;
          border-radius: 3px;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
          transform: translate(-1px, -1px);
        }

        .app-mark::after {
          content: "";
          position: absolute;
          width: 9px;
          height: 9px;
          right: 4px;
          bottom: 4px;
          border-radius: 50%;
          background: linear-gradient(135deg, #22d3ee 0%, #0a84ff 55%, #7c3aed 100%);
          box-shadow:
            5px 5px 0 -2px rgba(29, 29, 31, 0.72),
            inset 0 0 0 2px rgba(255, 255, 255, 0.22);
        }

        .icon-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          height: 30px;
          border: 0;
          border-radius: 50%;
          background: var(--control);
          color: var(--muted);
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
        }

        .icon-btn:hover {
          background: rgba(118, 118, 128, 0.18);
          color: var(--ink);
        }

        .tabs {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 2px;
          overflow: hidden;
          margin: 0 0 12px;
          border-radius: 8px;
          background: var(--control);
          padding: 3px;
        }

        .tab {
          height: 34px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--muted);
          cursor: default;
          font-size: 13px;
          font-weight: 600;
        }

        .tab[aria-selected="true"] {
          background: #ffffff;
          color: var(--ink);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        }

        .page {
          display: none;
          min-height: 0;
        }

        .page.active {
          display: contents;
        }

        .card {
          background: var(--panel);
          border-radius: 8px;
          border: 1px solid var(--line);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
          backdrop-filter: blur(18px);
        }

        .summary {
          padding: 14px 12px;
          text-align: center;
          color: var(--muted);
          font-size: 13px;
          line-height: 1.65;
        }

        .controls {
          margin-top: 10px;
          padding: 14px;
        }

        .hint {
          margin: 0 0 14px;
          color: var(--muted);
          text-align: center;
          font-size: 13px;
        }

        .field {
          display: grid;
          grid-template-columns: 1fr 88px 28px;
          align-items: center;
          gap: 8px;
          margin-top: 10px;
          font-size: 14px;
          font-weight: 600;
        }

        .field input,
        .field select {
          width: 88px;
          height: 36px;
          border: 1px solid var(--line-strong);
          border-radius: 8px;
          color: var(--ink);
          font: inherit;
          font-weight: 600;
          text-align: center;
          outline: none;
          box-sizing: border-box;
          background: rgba(255, 255, 255, 0.92);
        }

        .field input:focus,
        .field select:focus,
        .toolbar-select:focus,
        .feishu-input:focus {
          border-color: var(--blue);
          box-shadow: 0 0 0 3px rgba(0, 122, 255, 0.18);
        }

        .primary {
          width: 100%;
          height: 42px;
          margin-top: 12px;
          border: 0;
          border-radius: 8px;
          background: var(--blue);
          color: #ffffff;
          cursor: pointer;
          font: inherit;
          font-weight: 650;
          box-shadow: 0 8px 18px rgba(0, 122, 255, 0.24);
        }

        .primary:hover:not(:disabled) {
          background: var(--blue-hover);
        }

        .primary:disabled {
          cursor: not-allowed;
          opacity: 0.55;
        }

        .toolbar {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          align-items: center;
          gap: 5px;
          margin: 12px 0 8px;
        }

        .toolbar-select {
          height: 32px;
          min-width: 68px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.9);
          color: var(--ink);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
          outline: none;
          padding: 0 8px;
        }

        .small {
          height: 32px;
          padding: 0 12px;
          border: 1px solid var(--line);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.9);
          color: var(--ink);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 600;
        }

        .toolbar .small,
        .toolbar-select {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 100%;
          min-width: 0;
          height: 30px;
          padding: 0 5px;
          border-radius: 7px;
          font-size: 11px;
          line-height: 1;
          white-space: nowrap;
          box-sizing: border-box;
        }

        .toolbar-select {
          display: block;
          text-align: center;
          text-align-last: center;
        }

        .small.active {
          background: var(--blue);
          border-color: var(--blue);
          color: #ffffff;
        }

        .small:hover:not(:disabled),
        .toolbar-select:hover {
          background: #ffffff;
          border-color: var(--line-strong);
        }

        .small:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .message {
          min-height: 18px;
          margin: 8px 4px;
          color: var(--muted);
          font-size: 13px;
          text-align: center;
        }

        .message.error {
          color: var(--danger);
        }

        .feishu {
          margin-top: 10px;
          padding: 0;
        }

        .feishu-title {
          margin: 0;
          color: var(--ink);
          font-size: 15px;
          font-weight: 650;
          padding: 14px 12px 8px;
        }

        .feishu-body {
          display: block;
          padding: 0 12px 12px;
        }

        .feishu-grid {
          display: grid;
          gap: 8px;
        }

        .feishu-input {
          width: 100%;
          height: 34px;
          border: 1px solid var(--line-strong);
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.92);
          color: var(--ink);
          font: inherit;
          font-size: 13px;
          outline: none;
          padding: 0 10px;
          box-sizing: border-box;
        }

        .feishu-actions {
          display: grid;
          gap: 8px;
          margin-top: 10px;
        }

        .feishu-note {
          margin: 8px 0 0;
          color: var(--muted);
          font-size: 12px;
          line-height: 1.5;
        }

        .list {
          flex: 1;
          overflow-y: auto;
          padding-right: 2px;
        }

        .item {
          display: grid;
          grid-template-columns: 24px 54px 1fr 42px;
          gap: 8px;
          align-items: center;
          margin: 8px 0;
          padding: 8px;
          border-radius: 8px;
          background: rgba(255, 255, 255, 0.92);
          border: 1px solid var(--line);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          cursor: pointer;
        }

        .item:hover {
          border-color: var(--blue);
          box-shadow: 0 4px 12px rgba(0, 122, 255, 0.12);
        }

        .rank {
          align-self: start;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 20px;
          border-radius: 6px;
          background: var(--control);
          color: var(--muted);
          font-size: 12px;
          font-weight: 650;
        }

        .thumb {
          width: 54px;
          height: 54px;
          border-radius: 8px;
          background: #e5e5ea;
          object-fit: cover;
        }

        .meta {
          min-width: 0;
        }

        .note-title {
          overflow: hidden;
          color: #2b2926;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 2;
          font-size: 13px;
          font-weight: 650;
          line-height: 1.35;
        }

        .note-author,
        .note-likes {
          overflow: hidden;
          margin-top: 3px;
          color: var(--muted);
          font-size: 12px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .delete {
          width: 38px;
          height: 24px;
          border: 0;
          border-radius: 12px;
          background: var(--control);
          color: var(--muted);
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
        }

        .delete:hover {
          background: rgba(255, 59, 48, 0.12);
          color: var(--danger);
        }

        .empty {
          margin-top: 18px;
          padding: 28px 10px;
          color: var(--muted);
          text-align: center;
          font-size: 13px;
        }
      </style>

      <aside class="shell" part="shell">
        <div class="topbar">
          <div class="title"><span class="app-mark" aria-hidden="true"></span><span>微光定制小红书采集工具</span></div>
          <button class="icon-btn" data-action="close" title="关闭">×</button>
        </div>

        <div class="tabs" role="tablist" aria-label="采集功能">
          <button class="tab" data-page-tab="collect" type="button" aria-selected="true">博主采集</button>
          <button class="tab" data-page-tab="feishu" type="button" aria-selected="false">飞书配置</button>
        </div>

        <div class="page active" data-page="collect">
          <section class="card summary">
            <div data-role="summary">已采集 0 条候选笔记</div>
            <div data-role="scroll">自动滚动，直到达到数量或页面到底</div>
          </section>

          <section class="card controls">
            <p class="hint">请打开博主主页采集全部笔记</p>
            <label class="field">
              <span>筛选点赞数≥</span>
              <input data-role="min-likes" type="number" min="0" max="999999999" step="1" value="0">
              <span>的笔记</span>
            </label>
            <label class="field">
              <span>候选笔记数：</span>
              <input data-role="limit" type="number" min="1" max="5000" step="1" value="300">
              <span>条</span>
            </label>
            <button class="primary" data-action="start" type="button">开始采集 博主笔记</button>
            <div class="message" data-role="message"></div>
          </section>

          <div class="toolbar">
            <select class="toolbar-select" data-role="type-filter" title="内容类型">
              <option value="全部" selected>全部</option>
              <option value="图文">图文</option>
              <option value="视频">视频</option>
            </select>
            <button class="small" data-action="sort" type="button" disabled>点赞排序</button>
            <button class="small" data-action="capture-details" type="button" disabled>抓取正文</button>
            <button class="small" data-action="clear" type="button">清空</button>
            <button class="small" data-action="export" type="button" disabled>导出 Excel</button>
            <button class="small" data-action="import-feishu" type="button" disabled>导入飞书</button>
          </div>

          <div class="list" data-role="list">
            <div class="empty">暂无采集结果</div>
          </div>
        </div>

        <div class="page" data-page="feishu">
          <section class="card feishu" data-role="feishu-card">
            <p class="feishu-title">飞书多维表格配置</p>
            <div class="feishu-body">
              <div class="feishu-grid">
                <input class="feishu-input" data-role="feishu-app-id" type="text" placeholder="FEISHU_APP_ID">
                <input class="feishu-input" data-role="feishu-app-secret" type="password" placeholder="FEISHU_APP_SECRET">
                <input class="feishu-input" data-role="feishu-bitable-url" type="text" placeholder="飞书多维表格或 wiki 完整链接">
              </div>
              <p class="feishu-note">支持 /base/ 链接，也支持 /wiki/ 链接；链接必须包含 table= 参数。</p>
              <div class="feishu-actions">
                <button class="small" data-action="save-feishu" type="button">保存配置</button>
              </div>
              <div class="message" data-role="feishu-message"></div>
            </div>
          </section>
        </div>
      </aside>
    `;

    els = {
      shell: shadow.querySelector(".shell"),
      close: shadow.querySelector("[data-action='close']"),
      start: shadow.querySelector("[data-action='start']"),
      sort: shadow.querySelector("[data-action='sort']"),
      captureDetails: shadow.querySelector("[data-action='capture-details']"),
      clear: shadow.querySelector("[data-action='clear']"),
      export: shadow.querySelector("[data-action='export']"),
      saveFeishu: shadow.querySelector("[data-action='save-feishu']"),
      importFeishu: shadow.querySelector("[data-action='import-feishu']"),
      pageTabs: [...shadow.querySelectorAll("[data-page-tab]")],
      pages: [...shadow.querySelectorAll("[data-page]")],
      limit: shadow.querySelector("[data-role='limit']"),
      minLikes: shadow.querySelector("[data-role='min-likes']"),
      typeFilter: shadow.querySelector("[data-role='type-filter']"),
      feishuCard: shadow.querySelector("[data-role='feishu-card']"),
      feishuAppId: shadow.querySelector("[data-role='feishu-app-id']"),
      feishuAppSecret: shadow.querySelector("[data-role='feishu-app-secret']"),
      feishuBitableUrl: shadow.querySelector("[data-role='feishu-bitable-url']"),
      summary: shadow.querySelector("[data-role='summary']"),
      scroll: shadow.querySelector("[data-role='scroll']"),
      message: shadow.querySelector("[data-role='message']"),
      feishuMessage: shadow.querySelector("[data-role='feishu-message']"),
      list: shadow.querySelector("[data-role='list']"),
    };

    els.close.addEventListener("click", hidePanel);
    els.start.addEventListener("click", () => {
      if (state.running) {
        stopCollect();
      } else {
        startCollect();
      }
    });
    els.clear.addEventListener("click", clearRows);
    els.export.addEventListener("click", exportExcel);
    els.captureDetails.addEventListener("click", () => {
      if (state.capturingDetails) {
        stopDetailCapture();
      } else {
        captureFilteredDetails();
      }
    });
    els.saveFeishu.addEventListener("click", saveFeishuConfig);
    els.importFeishu.addEventListener("click", importFeishu);
    for (const tab of els.pageTabs) {
      tab.addEventListener("click", () => switchPage(tab.getAttribute("data-page-tab")));
    }
    els.sort.addEventListener("click", toggleLikeSort);
    els.minLikes.addEventListener("input", render);
    els.typeFilter.addEventListener("change", render);
    els.limit.addEventListener("input", render);
    els.list.addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-url]");
      if (button) {
        deleteRow(button.getAttribute("data-delete-url"));
        return;
      }
      const item = event.target.closest("[data-note-url]");
      if (item) openNoteDetail(item.getAttribute("data-note-url"));
    });

    render();
    loadFeishuConfig();
  }

  function showPanel() {
    createPanel();
    state.visible = true;
    applySplitLayout();
    els.shell.classList.add("open");
    collectVisibleCards();
    render();
  }

  function hidePanel() {
    if (state.running) stopCollect();
    state.visible = false;
    restoreSplitLayout();
    if (els.shell) els.shell.classList.remove("open");
  }

  function togglePanel() {
    createPanel();
    if (state.visible) {
      hidePanel();
    } else {
      showPanel();
    }
  }

  function switchPage(pageName) {
    for (const tab of els.pageTabs) {
      tab.setAttribute("aria-selected", tab.getAttribute("data-page-tab") === pageName ? "true" : "false");
    }
    for (const page of els.pages) {
      page.classList.toggle("active", page.getAttribute("data-page") === pageName);
    }
  }

  function resetForRun(limit) {
    state.running = false;
    state.done = false;
    state.stopped = false;
    state.capturingDetails = false;
    state.detailCurrent = 0;
    state.detailTotal = 0;
    state.detailRunToken += 1;
    state.error = "";
    state.message = "";
    state.limit = limit;
    state.scrollsUsed = 0;
    state.author = "";
    state.candidates = [];
    state.seen = new Set();
    state.nextOrder = 1;
  }

  async function startCollect() {
    if (state.capturingDetails) return;
    const limit = numberValue(els.limit.value, 300, 1, 5000);
    const minLikes = numberValue(els.minLikes.value, 0, 0, 999999999);
    els.limit.value = String(limit);
    els.minLikes.value = String(minLikes);

    resetForRun(limit);
    state.minLikes = minLikes;
    state.typeFilter = els.typeFilter.value || "全部";
    runToken += 1;
    const token = runToken;

    if (!isProfilePage()) {
      state.error = "请先打开小红书博主主页。";
      state.message = "地址格式应为 /user/profile/...";
      render();
      return;
    }

    state.running = true;
    state.message = "正在扫描当前页面...";
    render();

    let idleRounds = 0;

    try {
      while (state.running && token === runToken) {
        const beforeCount = state.candidates.length;
        collectVisibleCards();
        const added = state.candidates.length - beforeCount;

        if (state.candidates.length >= state.limit) {
          state.candidates = state.candidates.slice(0, state.limit);
          state.done = true;
          state.running = false;
          state.message = "已达到候选笔记数量，筛选完成。";
          break;
        }

        idleRounds = added > 0 ? 0 : idleRounds + 1;
        if (isNearPageBottom() && idleRounds > 0) {
          state.done = true;
          state.running = false;
          state.message = "已到达博主主页底部，采集完成。";
          break;
        }

        if (idleRounds >= MAX_IDLE_ROUNDS) {
          state.done = true;
          state.running = false;
          state.message = "连续多轮没有发现新笔记，采集完成。";
          break;
        }

        if (state.scrollsUsed >= MAX_AUTO_SCROLLS) {
          state.done = true;
          state.running = false;
          state.message = "已达到内部安全滚动上限，采集停止。";
          break;
        }

        state.scrollsUsed += 1;
        state.message = `正在自动滚动，第 ${state.scrollsUsed} 次，已采集候选 ${state.candidates.length}/${state.limit} 条。`;
        render();

        window.scrollBy({
          top: Math.round(window.innerHeight * 0.85),
          behavior: "smooth",
        });
        await sleep(SCAN_INTERVAL_MS);
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      state.running = false;
    }

    if (state.stopped && !state.error) {
      state.message = "已停止采集。";
    }
    render();
  }

  function stopCollect() {
    state.running = false;
    state.stopped = true;
    state.done = false;
    state.message = "已停止采集。";
    runToken += 1;
    render();
  }

  function findNoteAnchor(row) {
    const noteId = row.noteId || NOTE_UTILS.noteIdFromUrl(row.url);
    if (!noteId) return null;

    for (const anchor of document.querySelectorAll("a[href]")) {
      const card = cardForAnchor(anchor);
      if (
        card &&
        isVisible(card) &&
        NOTE_UTILS.noteIdFromUrl(anchor.getAttribute("href")) === noteId
      ) {
        return anchor;
      }
    }
    return null;
  }

  async function findNoteAnchorWithSearch(row) {
    const immediate = findNoteAnchor(row);
    if (immediate) return immediate;

    const originalScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    window.scrollTo({ top: 0, behavior: "auto" });
    await sleep(NOTE_SEARCH_SETTLE_MS);

    for (let index = 0; index < MAX_AUTO_SCROLLS; index += 1) {
      const anchor = findNoteAnchor(row);
      if (anchor) return anchor;
      if (isNearPageBottom()) break;
      window.scrollBy({
        top: Math.round(window.innerHeight * 0.8),
        behavior: "auto",
      });
      await sleep(NOTE_SEARCH_SETTLE_MS);
    }

    const anchor = findNoteAnchor(row);
    if (anchor) return anchor;
    window.scrollTo({ top: originalScrollTop, behavior: "auto" });
    throw new Error("当前页面找不到笔记卡片。");
  }

  async function realClickNote(row) {
    const anchor = await findNoteAnchorWithSearch(row);
    if (!anchor) throw new Error("当前页面找不到笔记卡片。");

    const card = cardForAnchor(anchor);
    (card || anchor).scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await sleep(150);
    const point = NOTE_UTILS.clickPointFromAnchor(anchor, card);
    if (!point) throw new Error("笔记卡片没有有效的屏幕坐标。");

    await sendRealMouseClick(point);
  }

  async function sendRealMouseClick(point) {
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "XHS_REAL_MOUSE_CLICK", point },
        (response) => {
          const runtimeError = chrome.runtime.lastError;
          if (runtimeError) {
            reject(new Error(runtimeError.message));
          } else if (!response || !response.ok) {
            reject(new Error(response && response.error ? response.error : "真实鼠标点击失败。"));
          } else {
            resolve();
          }
        }
      );
    });
  }

  function visibleDetailMask(noteId) {
    return [...document.querySelectorAll(".note-detail-mask[note-id]")].find(
      (mask) => isVisible(mask) && (!noteId || mask.getAttribute("note-id") === noteId)
    ) || null;
  }

  function waitForDetail(noteId, timeoutMs = 12000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const mask = visibleDetailMask(noteId);
        if (mask) {
          const data = NOTE_UTILS.extractDetailData(mask);
          if (
            Date.now() - startedAt >= DETAIL_MIN_SETTLE_MS &&
            data &&
            data.title &&
            NOTE_UTILS.detailContentReady(mask) &&
            data.content &&
            data.coverUrl
          ) {
            resolve(data);
            return;
          }
        }

        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error("详情加载超时。"));
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  function waitForDetailClosed(timeoutMs = 4000) {
    const startedAt = Date.now();
    return new Promise((resolve) => {
      const check = () => {
        if (!visibleDetailMask()) {
          resolve();
          return;
        }
        if (Date.now() - startedAt >= timeoutMs) {
          resolve();
          return;
        }
        window.setTimeout(check, 100);
      };
      check();
    });
  }

  async function closeNoteDetail() {
    const mask = visibleDetailMask();
    if (!mask) return;

    const closeButton = [...mask.querySelectorAll(".close-circle, .close-box")].find(isVisible);
    if (closeButton) {
      const point = NOTE_UTILS.clickPointFromElement(closeButton);
      if (point) {
        try {
          await sendRealMouseClick(point);
          await sleep(150);
          if (!visibleDetailMask()) return;
        } catch (_) {
          // Fall back to the page's click handler below.
        }
      }
      closeButton.click();
    }

    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      keyCode: 27,
      which: 27,
      bubbles: true,
    }));
  }

  async function openNoteDetail(url) {
    if (state.running || state.capturingDetails) return;
    if (!isProfilePage()) {
      state.error = "请在小红书博主主页中定位笔记。";
      render();
      return;
    }

    const row = state.candidates.find((item) => item.url === url);
    if (!row) return;

    await closeNoteDetail();
    await waitForDetailClosed();
    try {
      await realClickNote(row);
      await waitForDetail(row.noteId);
      state.error = "";
      state.message = `已定位到：${row.title || "这条笔记"}`;
    } catch (error) {
      state.error = error.message || String(error);
    }
    render();
  }

  function stopDetailCapture() {
    state.capturingDetails = false;
    state.detailRunToken += 1;
    state.message = "正在结束当前笔记，抓取任务即将停止。";
    render();
  }

  async function captureFilteredDetails() {
    if (state.running || state.capturingDetails) return;
    if (!isProfilePage()) {
      state.error = "请先打开小红书博主主页。";
      render();
      return;
    }

    const rows = displayRows();
    if (!rows.length) {
      state.error = "没有可抓取的筛选结果。";
      render();
      return;
    }

    state.capturingDetails = true;
    state.detailCurrent = 0;
    state.detailTotal = rows.length;
    state.detailRunToken += 1;
    const token = state.detailRunToken;
    state.error = "";
    state.message = `准备抓取 ${rows.length} 条笔记正文和封面链接。`;
    render();

    try {
      await closeNoteDetail();
      await waitForDetailClosed();

      for (let index = 0; index < rows.length; index += 1) {
        if (!state.capturingDetails || token !== state.detailRunToken) break;

        const row = rows[index];
        state.detailCurrent = index + 1;
        row.detailStatus = "capturing";
        row.detailError = "";
        state.message = `正在抓取第 ${index + 1}/${rows.length} 条：${row.title || "未识别标题"}`;
        render();

        try {
          await realClickNote(row);
          const data = await waitForDetail(row.noteId);
          row.title = data.title || row.title;
          row.content = data.content || "";
          row.coverUrl = data.coverUrl || row.coverUrl || row.cover || "";
          row.cover = row.coverUrl || row.cover;
          row.detailStatus = "done";
          row.detailError = "";
        } catch (error) {
          row.detailStatus = "error";
          row.detailError = error.message || String(error);
        } finally {
          await closeNoteDetail();
          await waitForDetailClosed();
        }
        render();
      }
    } catch (error) {
      state.error = error.message || String(error);
    } finally {
      const stopped = !state.capturingDetails || token !== state.detailRunToken;
      state.capturingDetails = false;
      if (stopped) {
        state.message = "已停止正文抓取。";
      } else {
        state.message = `正文抓取完成：${rows.filter((row) => row.detailStatus === "done").length}/${rows.length} 条成功。`;
      }
      render();
    }
  }

  function clearRows() {
    if (state.running) stopCollect();
    if (state.capturingDetails) stopDetailCapture();
    state.candidates = [];
    state.seen = new Set();
    state.nextOrder = 1;
    state.sortByLikes = false;
    state.error = "";
    state.message = "已清空采集结果。";
    render();
  }

  function deleteRow(url) {
    state.candidates = state.candidates.filter((row) => row.url !== url);
    state.seen.delete(url);
    render();
  }

  async function loadFeishuConfig() {
    try {
      const data = await chrome.storage.local.get("feishuConfig");
      const config = data.feishuConfig || {};
      els.feishuAppId.value = config.appId || "";
      els.feishuAppSecret.value = config.appSecret || "";
      els.feishuBitableUrl.value = config.bitableUrl || "";
      render();
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  function currentFeishuConfig() {
    return {
      appId: cleanText(els.feishuAppId.value),
      appSecret: cleanText(els.feishuAppSecret.value),
      bitableUrl: cleanText(els.feishuBitableUrl.value),
    };
  }

  async function saveFeishuConfig() {
    const config = currentFeishuConfig();
    if (!config.appId || !config.appSecret || !config.bitableUrl) {
      state.error = "请填写飞书 App ID、App Secret 和多维表格链接。";
      render();
      return;
    }
    try {
      await chrome.storage.local.set({ feishuConfig: config });
      state.error = "";
      state.message = "飞书配置已保存。";
      render();
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  function rowsForExternalUse() {
    return displayRows().map((row) => ({
      title: row.title || "",
      author: row.author || state.author || "",
      noteForm: row.noteForm || "图文",
      likes: Number.isFinite(row.likes) ? row.likes : "",
      url: row.url || "",
      content: String(row.content || ""),
      coverUrl: String(row.coverUrl || row.cover || ""),
    }));
  }

  async function importFeishu() {
    const rows = rowsForExternalUse();
    if (!rows.length) {
      state.error = "没有可导入飞书的数据。";
      render();
      return;
    }
    const config = currentFeishuConfig();
    if (!config.appId || !config.appSecret || !config.bitableUrl) {
      state.error = "请先填写并保存飞书配置。";
      switchPage("feishu");
      render();
      return;
    }

    const emptyContentCount = rows.filter((row) => !row.content.trim()).length;
    if (emptyContentCount) {
      state.error = `有 ${emptyContentCount} 条笔记正文为空，请先完成正文抓取。`;
      render();
      return;
    }

    state.importingFeishu = true;
    state.error = "";
    state.message = "正在导入飞书...";
    render();

    chrome.runtime.sendMessage(
      {
        type: "XHS_IMPORT_FEISHU",
        config,
        rows,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          state.error = runtimeError.message;
        } else if (!response || !response.ok) {
          state.error = response && response.error ? response.error : "导入飞书失败。";
        } else {
          const data = response.data || {};
          state.error = "";
          state.message = `飞书导入完成：新增 ${data.created || 0} 条，跳过重复 ${data.skipped || 0} 条。`;
        }
        state.importingFeishu = false;
        render();
      }
    );
  }

  function toggleLikeSort() {
    state.sortByLikes = !state.sortByLikes;
    state.message = state.sortByLikes ? "已按点赞从高到低排序。" : "已恢复顺序。";
    render();
  }

  function displayRows() {
    const rows = filteredRows();
    if (!state.sortByLikes) {
      return rows.sort((a, b) => a.order - b.order);
    }
    return rows.sort((a, b) => {
      const aLikes = Number.isFinite(a.likes) ? a.likes : -1;
      const bLikes = Number.isFinite(b.likes) ? b.likes : -1;
      if (bLikes !== aLikes) return bLikes - aLikes;
      return a.order - b.order;
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render() {
    if (!shadow || !els.shell) return;
    state.minLikes = numberValue(els.minLikes.value, state.minLikes, 0, 999999999);
    state.typeFilter = els.typeFilter.value || "全部";
    const visibleRows = displayRows();

    els.summary.textContent = state.candidates.length
      ? `已采集 ${state.candidates.length} 条候选，筛选出 ${visibleRows.length} 条`
      : "已采集 0 条候选笔记";
    els.scroll.textContent = state.capturingDetails
      ? `正文抓取中：第 ${state.detailCurrent}/${state.detailTotal} 条`
      : state.running
        ? `自动滚动中：已滚动 ${state.scrollsUsed} 次，候选目标 ${state.limit} 条`
        : `先采集 ${state.limit} 条候选，再按点赞和内容类型筛选`;
    els.message.textContent = state.error || state.message || "";
    els.message.classList.toggle("error", Boolean(state.error));
    els.feishuMessage.textContent = state.error || state.message || "";
    els.feishuMessage.classList.toggle("error", Boolean(state.error));
    els.start.textContent = state.running ? "停止采集" : "开始采集 博主笔记";
    els.start.disabled = state.capturingDetails;
    els.captureDetails.disabled = visibleRows.length === 0 || state.running;
    els.captureDetails.textContent = state.capturingDetails ? "停止抓取" : "抓取正文";
    els.export.disabled = visibleRows.length === 0 || state.capturingDetails;
    els.importFeishu.disabled = visibleRows.length === 0 || state.importingFeishu || state.capturingDetails;
    els.importFeishu.textContent = state.importingFeishu ? "导入中..." : "导入飞书";
    els.clear.disabled = state.capturingDetails || (state.candidates.length === 0 && !state.running);
    els.sort.disabled = state.capturingDetails || visibleRows.length < 2;
    els.sort.textContent = state.sortByLikes ? "恢复顺序" : "点赞排序";
    els.sort.classList.toggle("active", state.sortByLikes);

    if (!visibleRows.length) {
      els.list.innerHTML = '<div class="empty">暂无采集结果</div>';
      return;
    }

    els.list.innerHTML = visibleRows
      .map((row, index) => {
        const title = escapeHtml(row.title || "未识别标题");
        const author = escapeHtml(row.author || state.author || "未识别作者");
        const likes = row.likes === "" ? "-" : String(row.likes);
        const noteForm = escapeHtml(row.noteForm || "图文");
        const hasContent = Boolean(String(row.content || "").trim());
        const detailStatus = row.detailStatus === "capturing"
          ? "抓取中..."
          : row.detailStatus === "done" && hasContent
            ? "正文已抓取"
            : row.detailStatus === "error" || row.detailStatus === "done"
              ? "正文抓取失败"
              : "";
        const cover = row.cover
          ? `<img class="thumb" src="${escapeHtml(row.cover)}" alt="">`
          : '<div class="thumb"></div>';
        return `
          <article class="item" data-note-url="${escapeHtml(row.url)}">
            <div class="rank">${index + 1}</div>
            ${cover}
            <div class="meta">
              <div class="note-title" title="${title}">${title}</div>
              <div class="note-author">${author}</div>
              <div class="note-likes">${noteForm} · 点赞数: ${escapeHtml(likes)}${detailStatus ? ` · ${escapeHtml(detailStatus)}` : ""}</div>
            </div>
            <button class="delete" type="button" data-delete-url="${escapeHtml(row.url)}">删除</button>
          </article>
        `;
      })
      .join("");
  }

  function safeFilenamePart(value, fallback) {
    const cleaned = cleanText(value)
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80);
    return cleaned || fallback;
  }

  function exportExcel() {
    const exportRows = rowsForExternalUse();
    if (!exportRows.length) {
      state.error = "没有可导出的数据。";
      render();
      return;
    }
    const xlsx = globalThis.XLSX;
    if (!xlsx) {
      state.error = "Excel 生成库未加载，请重新加载插件。";
      render();
      return;
    }

    const rows = exportRows.map((row) => ({
      标题: row.title || "",
      作者: row.author || "",
      笔记形式: row.noteForm || "图文",
      点赞: Number.isFinite(row.likes) ? row.likes : "",
      原文链接: row.url || "",
      正文: row.content || "",
      封面链接: row.coverUrl || "",
    }));
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(rows, {
      header: ["标题", "作者", "笔记形式", "点赞", "原文链接", "正文", "封面链接"],
    });
    worksheet["!cols"] = [
      { wch: 42 },
      { wch: 18 },
      { wch: 10 },
      { wch: 12 },
      { wch: 72 },
      { wch: 60 },
      { wch: 72 },
    ];
    xlsx.utils.book_append_sheet(workbook, worksheet, "小红书笔记");

    const base64 = xlsx.write(workbook, { bookType: "xlsx", type: "base64" });
    const author = safeFilenamePart(state.author || (exportRows[0] && exportRows[0].author), "小红书博主");
    const filename = `${author}_${exportRows.length}.xlsx`;
    chrome.runtime.sendMessage(
      {
        type: "XHS_DOWNLOAD_XLSX",
        filename,
        base64,
      },
      (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          state.error = runtimeError.message;
        } else if (!response || !response.ok) {
          state.error = response && response.error ? response.error : "下载失败。";
        } else {
          state.error = "";
          state.message = `已生成 ${filename}`;
        }
        render();
      }
    );
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return false;

    if (message.type === "XHS_TOGGLE_PANEL") {
      togglePanel();
      sendResponse({ ok: true, visible: state.visible });
      return false;
    }

    if (message.type === "XHS_SHOW_PANEL") {
      showPanel();
      sendResponse({ ok: true, visible: true });
      return false;
    }

    return false;
  });
})();
