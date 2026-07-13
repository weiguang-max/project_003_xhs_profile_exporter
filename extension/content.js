"use strict";

(() => {
  if (window.__xhsBloggerCollectorLoaded) return;
  window.__xhsBloggerCollectorLoaded = true;

  const NOTE_UTILS = globalThis.XHS_NOTE_UTILS;
  const PROFILE_PATH_RE = /^\/user\/profile\/[^/?#]+/;
  const NOTE_PATH_RE = /^\/(?:explore|discovery\/item)\/([^/?#]+)/;
  const PROFILE_NOTE_PATH_RE = /^\/user\/profile\/[^/?#]+\/([^/?#]+)/;
  const SCAN_INTERVAL_MS = 1200;
  const MAX_IDLE_ROUNDS = 4;
  const MAX_AUTO_SCROLLS = 220;
  const DETAIL_MIN_SETTLE_MS = 800;
  const NOTE_SEARCH_SETTLE_MS = 600;

  const state = {
    running: false,
    done: false,
    stopped: false,
    capturingDetails: false,
    detailCurrent: 0,
    detailTotal: 0,
    detailRunToken: 0,
    limit: 300,
    scrollsUsed: 0,
    author: "",
    candidates: [],
    seen: new Set(),
    nextOrder: 1,
    message: "请打开小红书博主主页。",
    error: "",
  };

  let runToken = 0;
  let profileContext = PROFILE_PATH_RE.test(location.pathname);

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function emit(event, payload = {}) {
    chrome.runtime.sendMessage(
      { type: "XHS_COLLECTOR_EVENT", event, payload, snapshot: snapshot() },
      () => void chrome.runtime.lastError
    );
  }

  function snapshot() {
    return {
      running: state.running,
      done: state.done,
      stopped: state.stopped,
      capturingDetails: state.capturingDetails,
      detailCurrent: state.detailCurrent,
      detailTotal: state.detailTotal,
      limit: state.limit,
      scrollsUsed: state.scrollsUsed,
      author: state.author,
      candidates: state.candidates.map((row) => ({ ...row })),
      message: state.message,
      error: state.error,
      isProfilePage: isProfilePage(),
    };
  }

  function isProfilePage() {
    if (location.hostname !== "www.xiaohongshu.com") return false;
    if (PROFILE_PATH_RE.test(location.pathname)) {
      profileContext = true;
      return true;
    }
    return profileContext && state.candidates.length > 0;
  }

  function setStatus(message, error = "") {
    state.message = message || "";
    state.error = error || "";
    emit("status");
  }

  function isVisible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
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
        if (value && value.length <= 60 && !/关注|粉丝|获赞|IP属地|小红书号/.test(value)) return value;
      }
    }

    return cleanText(document.title).replace(/- 小红书$/, "").replace(/小红书$/, "").trim();
  }

  function normalizeNoteUrl(href) {
    if (!href) return "";
    try {
      const url = new URL(href, location.origin);
      if (url.hostname !== "www.xiaohongshu.com") return "";
      const match = url.pathname.match(NOTE_PATH_RE) || url.pathname.match(PROFILE_NOTE_PATH_RE);
      if (!match) return "";
      url.hash = "";
      url.pathname = `/explore/${match[1]}`;
      return url.toString();
    } catch (_) {
      return "";
    }
  }

  function noteUrlScore(url) {
    if (!url) return -1;
    try {
      const parsed = new URL(url);
      return (parsed.searchParams.has("xsec_token") ? 10 : 0) +
        (parsed.searchParams.has("xsec_source") ? 5 : 0) +
        (parsed.search ? 1 : 0);
    } catch (_) {
      return -1;
    }
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

  function bestNoteUrlFromCard(card, fallbackAnchor) {
    let best = "";
    let bestScore = -1;
    for (const anchor of [fallbackAnchor, ...card.querySelectorAll("a[href]")].filter(Boolean)) {
      const url = normalizeNoteUrl(anchor.getAttribute("href"));
      const score = noteUrlScore(url);
      if (score > bestScore) {
        best = url;
        bestScore = score;
      }
    }
    return best;
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
    return /^(点赞|赞|喜欢|like)?\s*[\d,.]+(\.\d+)?\s*(万|w|k)?\s*$|^赞$|^点赞$/i.test(cleanText(value));
  }

  function titleFromCard(card, anchor) {
    let title = textFromSelector(card, [".title", ".note-title", "[class*='title']", "[class*='Title']", "[class*='footer'] span"]);
    if (!title) title = cleanText(anchor.getAttribute("title")) || cleanText(anchor.getAttribute("aria-label"));
    if (!title) {
      const image = card.querySelector("img[alt]");
      title = cleanText(image ? image.getAttribute("alt") : "");
    }
    if (!title) title = cleanText(card.textContent).split(" ").map(cleanText).find((line) => line.length > 1 && !looksLikeLikeText(line)) || "";
    return cleanText(title).replace(/\s*(点赞|赞|like)\s*$/i, "").slice(0, 300);
  }

  function parseLikeCount(rawValue) {
    const raw = cleanText(rawValue).replace(/,/g, "").replace(/点赞|赞|喜欢|likes?|人/g, "").trim();
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
        const value = [node.getAttribute("aria-label"), node.getAttribute("data-count"), node.textContent].filter(Boolean).join(" ");
        if (parseLikeCount(value) !== null) return cleanText(node.textContent || node.getAttribute("aria-label") || "");
      }
    }
    return "";
  }

  function coverFromCard(card) {
    const image = card.querySelector("img");
    return image ? image.currentSrc || image.src || image.getAttribute("src") || "" : "";
  }

  function noteFormFromCard(card) {
    const text = cleanText(card.textContent);
    const marker = card.querySelector("video, svg[class*='play'], [class*='play'], [class*='Play'], [class*='video'], [class*='Video']");
    return marker || /视频|播放|▶/.test(text) ? "视频" : "图文";
  }

  function collectVisibleCards() {
    const author = profileAuthor();
    if (author) state.author = author;
    let added = 0;
    for (const anchor of document.querySelectorAll("a[href]")) {
      if (state.candidates.length >= state.limit) break;
      const card = cardForAnchor(anchor);
      if (!card || !isVisible(card)) continue;
      const url = bestNoteUrlFromCard(card, anchor);
      if (!url || state.seen.has(url)) continue;
      const likes = parseLikeCount(likeTextFromCard(card));
      const cover = coverFromCard(card);
      state.seen.add(url);
      state.candidates.push({
        order: state.nextOrder++,
        noteId: NOTE_UTILS.noteIdFromUrl(url),
        author: state.author || "",
        title: titleFromCard(card, anchor),
        likes: likes === null ? 0 : likes,
        noteForm: noteFormFromCard(card),
        url,
        cover,
        coverUrl: cover,
        content: "",
        detailStatus: "idle",
        detailError: "",
      });
      added += 1;
    }
    return added;
  }

  function isNearPageBottom() {
    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    const height = Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight);
    return scrollTop + viewport >= height - 24;
  }

  function resetCollection(limit) {
    state.running = false;
    state.done = false;
    state.stopped = false;
    state.limit = limit;
    state.scrollsUsed = 0;
    state.author = "";
    state.candidates = [];
    state.seen = new Set();
    state.nextOrder = 1;
    runToken += 1;
  }

  async function startCollect(limit) {
    if (state.running || state.capturingDetails) return;
    resetCollection(Math.max(1, Math.min(Number(limit) || 300, 5000)));
    if (!isProfilePage()) {
      setStatus("请先打开小红书博主主页。", "当前页面不是小红书博主主页。");
      return;
    }

    state.running = true;
    setStatus("正在扫描当前页面。");
    const token = runToken;
    let idleRounds = 0;
    try {
      while (state.running && token === runToken) {
        const beforeCount = state.candidates.length;
        const added = collectVisibleCards();
        if (state.candidates.length >= state.limit) {
          state.candidates = state.candidates.slice(0, state.limit);
          state.done = true;
          state.running = false;
          setStatus("已达到候选笔记数量，采集完成。");
          break;
        }
        idleRounds = added > 0 ? 0 : idleRounds + 1;
        if ((isNearPageBottom() && idleRounds > 0) || idleRounds >= MAX_IDLE_ROUNDS || state.scrollsUsed >= MAX_AUTO_SCROLLS) {
          state.done = true;
          state.running = false;
          setStatus("已到达页面底部或连续没有发现新笔记，采集完成。");
          break;
        }
        state.scrollsUsed += 1;
        setStatus(`正在自动滚动，第 ${state.scrollsUsed} 次，已采集候选 ${state.candidates.length}/${state.limit} 条。`);
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: "smooth" });
        await sleep(SCAN_INTERVAL_MS);
        if (beforeCount === state.candidates.length && !state.running) break;
      }
    } catch (error) {
      state.running = false;
      setStatus("采集失败。", error instanceof Error ? error.message : String(error));
    }
    if (state.stopped) setStatus("已停止采集。");
    else emit("state");
  }

  function stopCollect() {
    state.running = false;
    state.stopped = true;
    state.done = false;
    runToken += 1;
    setStatus("已停止采集。");
  }

  function findNoteAnchor(row) {
    const noteId = row.noteId || NOTE_UTILS.noteIdFromUrl(row.url);
    if (!noteId) return null;
    for (const anchor of document.querySelectorAll("a[href]")) {
      const card = cardForAnchor(anchor);
      if (card && isVisible(card) && NOTE_UTILS.noteIdFromUrl(anchor.getAttribute("href")) === noteId) return anchor;
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
      window.scrollBy({ top: Math.round(window.innerHeight * 0.8), behavior: "auto" });
      await sleep(NOTE_SEARCH_SETTLE_MS);
    }
    const anchor = findNoteAnchor(row);
    if (anchor) return anchor;
    window.scrollTo({ top: originalScrollTop, behavior: "auto" });
    throw new Error("当前页面找不到笔记卡片。");
  }

  function sendRealMouseClick(point) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "XHS_REAL_MOUSE_CLICK", point }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) reject(new Error(runtimeError.message));
        else if (!response || !response.ok) reject(new Error(response && response.error || "真实鼠标点击失败。"));
        else resolve();
      });
    });
  }

  async function realClickNote(row) {
    const anchor = await findNoteAnchorWithSearch(row);
    const card = cardForAnchor(anchor);
    (card || anchor).scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    await sleep(150);
    const point = NOTE_UTILS.clickPointFromAnchor(anchor, card);
    if (!point) throw new Error("笔记卡片没有有效的屏幕坐标。");
    await sendRealMouseClick(point);
  }

  function visibleDetailMask(noteId) {
    return [...document.querySelectorAll(".note-detail-mask[note-id]")].find((mask) => isVisible(mask) && (!noteId || mask.getAttribute("note-id") === noteId)) || null;
  }

  function waitForDetail(noteId, timeoutMs = 12000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        const mask = visibleDetailMask(noteId);
        if (mask) {
          const data = NOTE_UTILS.extractDetailData(mask);
          if (Date.now() - startedAt >= DETAIL_MIN_SETTLE_MS && data && data.title && NOTE_UTILS.detailContentReady(mask) && data.content && data.coverUrl) {
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
        if (!visibleDetailMask() || Date.now() - startedAt >= timeoutMs) resolve();
        else window.setTimeout(check, 100);
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
          // Fall through to the page event handlers.
        }
      }
      closeButton.click();
    }
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
  }

  async function openNoteDetail(row) {
    if (state.running || state.capturingDetails) return;
    if (!isProfilePage()) throw new Error("请在小红书博主主页中定位笔记。");
    await closeNoteDetail();
    await waitForDetailClosed();
    await realClickNote(row);
    await waitForDetail(row.noteId || NOTE_UTILS.noteIdFromUrl(row.url));
    setStatus(`已定位到：${row.title || "这条笔记"}`);
  }

  async function captureDetails(rows) {
    if (state.running || state.capturingDetails) return;
    if (!isProfilePage()) throw new Error("请先打开小红书博主主页。");
    const items = Array.isArray(rows) ? rows : [];
    if (!items.length) throw new Error("没有可抓取的筛选结果。");
    state.capturingDetails = true;
    state.detailCurrent = 0;
    state.detailTotal = items.length;
    state.detailRunToken += 1;
    const token = state.detailRunToken;
    emit("detail-start");
    try {
      await closeNoteDetail();
      await waitForDetailClosed();
      for (let index = 0; index < items.length; index += 1) {
        if (!state.capturingDetails || token !== state.detailRunToken) break;
        const row = { ...items[index] };
        state.detailCurrent = index + 1;
        emit("detail-progress", { index: index + 1, total: items.length, row, status: "capturing" });
        try {
          await realClickNote(row);
          const data = await waitForDetail(row.noteId || NOTE_UTILS.noteIdFromUrl(row.url));
          const result = {
            ...row,
            title: data.title || row.title,
            content: data.content || "",
            coverUrl: data.coverUrl || row.coverUrl || row.cover || "",
            cover: data.coverUrl || row.coverUrl || row.cover || row.cover,
            detailStatus: "done",
            detailError: "",
          };
          const localIndex = state.candidates.findIndex((item) => item.url === result.url);
          if (localIndex >= 0) state.candidates[localIndex] = { ...state.candidates[localIndex], ...result };
          emit("detail-progress", { index: index + 1, total: items.length, row: result, status: "done", data: result });
        } catch (error) {
          const localIndex = state.candidates.findIndex((item) => item.url === row.url);
          if (localIndex >= 0) {
            state.candidates[localIndex] = { ...state.candidates[localIndex], detailStatus: "error", detailError: error.message || String(error) };
          }
          emit("detail-progress", { index: index + 1, total: items.length, row, status: "error", error: error.message || String(error) });
        } finally {
          await closeNoteDetail();
          await waitForDetailClosed();
        }
      }
    } finally {
      const stopped = !state.capturingDetails || token !== state.detailRunToken;
      state.capturingDetails = false;
      setStatus(stopped ? "已停止正文抓取。" : "正文抓取完成。", "");
      emit("detail-complete", { stopped });
    }
  }

  function clearRows() {
    if (state.running) stopCollect();
    if (state.capturingDetails) {
      state.capturingDetails = false;
      state.detailRunToken += 1;
    }
    resetCollection(state.limit);
    setStatus("已清空采集结果。");
  }

  function deleteRow(url) {
    state.candidates = state.candidates.filter((row) => row.url !== url);
    state.seen.delete(url);
    emit("state");
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== "string") return false;

    if (message.type === "XHS_GET_STATE") {
      sendResponse({ ok: true, snapshot: snapshot() });
      return false;
    }

    if (message.type === "XHS_START_COLLECT") {
      startCollect(message.limit).catch((error) => setStatus("采集失败。", error.message || String(error)));
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "XHS_STOP_COLLECT") {
      stopCollect();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "XHS_CLEAR_ROWS") {
      clearRows();
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "XHS_DELETE_ROW") {
      deleteRow(message.url || "");
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "XHS_OPEN_NOTE") {
      openNoteDetail(message.row)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => {
          setStatus("无法打开笔记详情。", error.message || String(error));
          sendResponse({ ok: false, error: error.message || String(error) });
        });
      return true;
    }

    if (message.type === "XHS_CAPTURE_DETAILS") {
      captureDetails(message.rows)
        .catch((error) => setStatus("正文抓取失败。", error.message || String(error)));
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "XHS_STOP_DETAIL_CAPTURE") {
      state.capturingDetails = false;
      state.detailRunToken += 1;
      setStatus("正在停止正文抓取。");
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  emit("ready");
})();
