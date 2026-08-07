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

  function imageUrlFromElement(element) {
    if (!element) return "";
    const directUrl =
      element.currentSrc ||
      element.src ||
      (typeof element.getAttribute === "function" && element.getAttribute("src")) ||
      (typeof element.getAttribute === "function" && element.getAttribute("data-src")) ||
      "";
    if (directUrl) return String(directUrl);

    const background = element.style && (element.style.backgroundImage || element.style.background || "");
    const match = String(background).match(/url\(["']?(.*?)["']?\)/);
    return match ? match[1] : "";
  }

  function extractCoverUrlFromSlide(slide) {
    if (!slide) return "";
    const candidates = [
      slide,
      typeof slide.querySelector === "function" ? slide.querySelector(".note-slider-img") : null,
      typeof slide.querySelector === "function" ? slide.querySelector("img") : null,
    ];
    for (const candidate of candidates) {
      const url = imageUrlFromElement(candidate);
      if (url) return url;
    }
    return "";
  }

  function extractCoverUrl(root) {
    if (!root) return "";
    const firstSlide = root.querySelector(
      '#noteContainer .note-slider .swiper-slide-active:not(.swiper-slide-duplicate), #noteContainer .note-slider .swiper-slide[data-swiper-slide-index="0"]:not(.swiper-slide-duplicate)'
    );
    const firstSlideUrl = extractCoverUrlFromSlide(firstSlide);
    if (firstSlideUrl) return firstSlideUrl;

    const images = root.querySelectorAll("#noteContainer .media-container img");
    for (const image of images) {
      const url = imageUrlFromElement(image);
      if (url) return url;
    }
    return "";
  }

  function extractPublishTime(root) {
    if (!root) return "";
    const dateNode = root.querySelector(".bottom-container .date");
    return dateNode ? String(dateNode.textContent || "").trim() : "";
  }

  function extractDetailData(root) {
    if (!root) return null;
    const titleNode = root.querySelector("#detail-title");
    return {
      title: cleanText(titleNode ? titleNode.textContent : ""),
      content: extractDetailText(root),
      coverUrl: extractCoverUrl(root),
      publishTime: extractPublishTime(root),
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
    extractPublishTime,
    extractDetailData,
    matchesKeyword,
    clickPointFromElement,
    clickPointFromAnchor,
  };
})();
