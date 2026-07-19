"use strict";

(() => {
  const NOTE_PATH_RE = /^\/(?:explore|discovery\/item)\/([^/?#]+)/;
  const PROFILE_NOTE_PATH_RE = /^\/user\/profile\/[^/?#]+\/([^/?#]+)/;

  function cleanText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function noteIdFromUrl(href) {
    if (!href) return "";
    try {
      const base = (globalThis.location && globalThis.location.origin) || "https://www.xiaohongshu.com";
      const url = new URL(href, base);
      if (url.hostname !== "www.xiaohongshu.com") return "";
      const match = url.pathname.match(NOTE_PATH_RE) || url.pathname.match(PROFILE_NOTE_PATH_RE);
      return match ? match[1] : "";
    } catch (_) {
      return "";
    }
  }

  function extractDetailText(root) {
    if (!root) return "";
    return [...root.querySelectorAll("#detail-desc .note-text")]
      .map((node) => cleanText(node.textContent))
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  function detailContentReady(root) {
    return Boolean(root && root.querySelectorAll("#detail-desc .note-text").length);
  }

  function extractCoverUrl(root) {
    if (!root) return "";
    const images = root.querySelectorAll("#noteContainer .media-container img");
    for (const image of images) {
      const url = image.currentSrc || image.src || image.getAttribute("src") || "";
      if (url) return String(url);
    }
    return "";
  }

  function extractDetailData(root) {
    if (!root) return null;
    const titleNode = root.querySelector("#detail-title");
    return {
      title: cleanText(titleNode ? titleNode.textContent : ""),
      content: extractDetailText(root),
      coverUrl: extractCoverUrl(root),
    };
  }

  function matchesKeyword(row, keyword) {
    const normalizedKeyword = String(keyword || "").trim().toLowerCase();
    if (!normalizedKeyword) return true;
    return [row && row.title, row && row.content]
      .some((value) => String(value || "").toLowerCase().includes(normalizedKeyword));
  }

  function clickPointFromElement(element) {
    if (!element || typeof element.getBoundingClientRect !== "function") return null;
    const rect = element.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  }

  function clickPointFromAnchor(anchor, card) {
    const candidates = [
      anchor && typeof anchor.querySelector === "function" ? anchor.querySelector("img") : null,
      anchor && anchor.parentElement,
      card && typeof card.querySelector === "function" ? card.querySelector("img") : null,
      anchor,
      card,
    ];
    for (const candidate of candidates) {
      const point = clickPointFromElement(candidate);
      if (point) return point;
    }
    return null;
  }

  globalThis.XHS_NOTE_UTILS = {
    noteIdFromUrl,
    extractDetailText,
    detailContentReady,
    extractCoverUrl,
    extractDetailData,
    matchesKeyword,
    clickPointFromElement,
    clickPointFromAnchor,
  };
})();
