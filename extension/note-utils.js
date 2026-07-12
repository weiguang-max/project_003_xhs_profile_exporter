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

  function dispatchProfileCardClick(target) {
    if (!target) return false;

    target.addEventListener(
      "click",
      (event) => event.preventDefault(),
      { capture: true, once: true }
    );
    target.click();
    return true;
  }

  globalThis.XHS_NOTE_UTILS = {
    noteIdFromUrl,
    extractDetailText,
    extractCoverUrl,
    extractDetailData,
    dispatchProfileCardClick,
  };
})();
