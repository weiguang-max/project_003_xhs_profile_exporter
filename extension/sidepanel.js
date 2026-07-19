"use strict";

(() => {
  const XHS_ORIGIN = "https://www.xiaohongshu.com/";
  const PROFILE_RE = /^\/user\/profile\/[^/?#]+/;
  const FEISHU_UTILS = globalThis.XHS_FEISHU_UTILS;
  const NOTE_UTILS = globalThis.XHS_NOTE_UTILS;
  const state = {
    activeTabId: 0,
    activeUrl: "",
    isXhs: false,
    running: false,
    capturingDetails: false,
    detailCurrent: 0,
    detailTotal: 0,
    author: "",
    candidates: [],
    message: "",
    error: "",
    keyword: "",
    minLikes: 0,
    typeFilter: "全部",
    limit: 300,
    sortByLikes: false,
    importingFeishu: false,
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    tabState: $("tabState"),
    summary: $("summary"),
    scrollStatus: $("scrollStatus"),
    pageHint: $("pageHint"),
    keyword: $("keyword"),
    minLikes: $("minLikes"),
    limit: $("limit"),
    typeFilter: $("typeFilter"),
    start: $("start"),
    capture: $("capture"),
    clear: $("clear"),
    sort: $("sort"),
    export: $("export"),
    importFeishu: $("importFeishu"),
    message: $("message"),
    list: $("list"),
    feishuAppId: $("feishuAppId"),
    feishuAppSecret: $("feishuAppSecret"),
    feishuBitableUrl: $("feishuBitableUrl"),
    saveFeishu: $("saveFeishu"),
    feishuMessage: $("feishuMessage"),
  };

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0] || null;
  }

  function isXhsUrl(url) {
    return typeof url === "string" && url.startsWith(XHS_ORIGIN);
  }

  async function sendToActiveTab(message) {
    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error("无法获取当前标签页。");
    state.activeTabId = tab.id;
    state.activeUrl = tab.url || "";
    state.isXhs = isXhsUrl(state.activeUrl);
    if (!state.isXhs) throw new Error("当前页面不是小红书页面。");
    try {
      return await chrome.tabs.sendMessage(tab.id, message);
    } catch (_) {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["note-utils.js", "content.js"] });
      return await chrome.tabs.sendMessage(tab.id, message);
    }
  }

  async function syncActiveTab() {
    try {
      const tab = await getActiveTab();
      state.activeTabId = tab && tab.id || 0;
      state.activeUrl = tab && tab.url || "";
      state.isXhs = isXhsUrl(state.activeUrl);
      if (!state.isXhs) {
        state.candidates = [];
        state.error = "";
        state.message = "当前页面不是小红书页面，请打开小红书博主主页。";
        render();
        return;
      }
      const response = await sendToActiveTab({ type: "XHS_GET_STATE" });
      if (response && response.snapshot) applySnapshot(response.snapshot);
      else render();
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  function applySnapshot(snapshot) {
    state.running = Boolean(snapshot.running);
    state.capturingDetails = Boolean(snapshot.capturingDetails);
    state.detailCurrent = snapshot.detailCurrent || 0;
    state.detailTotal = snapshot.detailTotal || 0;
    state.author = snapshot.author || state.author;
    state.candidates = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
    state.message = snapshot.message || "";
    state.error = snapshot.error || "";
    render();
  }

  function filteredRows() {
    return state.candidates.filter((row) => {
      const likes = Number.isFinite(row.likes) ? row.likes : 0;
      return NOTE_UTILS.matchesKeyword(row, state.keyword) &&
        (state.minLikes <= 0 || likes >= state.minLikes) &&
        (state.typeFilter === "全部" || row.noteForm === state.typeFilter);
    });
  }

  function displayRows() {
    const rows = filteredRows().slice();
    if (!state.sortByLikes) return rows.sort((a, b) => a.order - b.order);
    return rows.sort((a, b) => (Number.isFinite(b.likes) ? b.likes : 0) - (Number.isFinite(a.likes) ? a.likes : 0) || a.order - b.order);
  }

  function findRow(url) {
    return state.candidates.find((row) => row.url === url);
  }

  function rowsForExternalUse() {
    return displayRows().map((row) => ({
      title: row.title || "",
      author: row.author || state.author || "",
      noteForm: row.noteForm || "图文",
      likes: Number.isFinite(row.likes) ? row.likes : 0,
      url: row.url || "",
      content: String(row.content || ""),
      coverUrl: String(row.coverUrl || row.cover || ""),
    }));
  }

  async function startCollect() {
    state.limit = Math.max(1, Math.min(Number.parseInt(els.limit.value, 10) || 300, 5000));
    els.limit.value = String(state.limit);
    try {
      await sendToActiveTab({ type: "XHS_START_COLLECT", limit: state.limit });
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  async function captureDetails() {
    const rows = displayRows();
    if (!rows.length) {
      state.error = "没有可抓取的筛选结果。";
      render();
      return;
    }
    try {
      await sendToActiveTab({ type: "XHS_CAPTURE_DETAILS", rows });
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  async function openNote(row) {
    try {
      await sendToActiveTab({ type: "XHS_OPEN_NOTE", row });
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  async function clearRows() {
    try {
      await sendToActiveTab({ type: "XHS_CLEAR_ROWS" });
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  async function deleteRow(url) {
    try {
      await sendToActiveTab({ type: "XHS_DELETE_ROW", url });
      state.candidates = state.candidates.filter((row) => row.url !== url);
      render();
    } catch (error) {
      state.error = error.message || String(error);
      render();
    }
  }

  function safeFilenamePart(value, fallback) {
    return cleanText(value).replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80) || fallback;
  }

  function exportExcel() {
    const rows = rowsForExternalUse();
    if (!rows.length) {
      state.error = "没有可导出的数据。";
      render();
      return;
    }
    if (!globalThis.XLSX) {
      state.error = "Excel 生成库未加载，请重新加载插件。";
      render();
      return;
    }
    const values = rows.map((row) => ({
      标题: row.title,
      作者: row.author,
      笔记形式: row.noteForm,
      点赞: row.likes,
      原文链接: row.url,
      正文: row.content,
      封面链接: row.coverUrl,
    }));
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(values, { header: ["标题", "作者", "笔记形式", "点赞", "原文链接", "正文", "封面链接"] });
    worksheet["!cols"] = [{ wch: 42 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 72 }, { wch: 60 }, { wch: 72 }];
    XLSX.utils.book_append_sheet(workbook, worksheet, "小红书笔记");
    const base64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });
    const filename = `${safeFilenamePart(state.author || rows[0].author, "小红书博主")}_${rows.length}.xlsx`;
    chrome.runtime.sendMessage({ type: "XHS_DOWNLOAD_XLSX", filename, base64 }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) state.error = runtimeError.message;
      else if (!response || !response.ok) state.error = response && response.error || "下载失败。";
      else { state.error = ""; state.message = `已生成 ${filename}`; }
      render();
    });
  }

  async function loadFeishuConfig() {
    const data = await chrome.storage.local.get("feishuConfig");
    const config = data.feishuConfig || {};
    els.feishuAppId.value = config.appId || "";
    els.feishuAppSecret.value = config.appSecret || "";
    els.feishuBitableUrl.value = config.bitableUrl || "";
  }

  async function saveFeishuConfig() {
    await chrome.storage.local.set({ feishuConfig: {
      appId: cleanText(els.feishuAppId.value),
      appSecret: cleanText(els.feishuAppSecret.value),
      bitableUrl: cleanText(els.feishuBitableUrl.value),
    } });
    els.feishuMessage.textContent = "飞书配置已保存。";
  }

  async function importFeishu() {
    const rows = rowsForExternalUse();
    const data = await chrome.storage.local.get("feishuConfig");
    const config = data.feishuConfig || {};
    if (!config.appId || !config.appSecret || !config.bitableUrl) {
      state.error = "请先在飞书配置页填写并保存配置。";
      render();
      return;
    }
    const importBlockMessage = FEISHU_UTILS.getFeishuImportBlockMessage(rows);
    if (importBlockMessage) {
      state.error = importBlockMessage;
      render();
      return;
    }
    state.importingFeishu = true;
    state.error = "";
    state.message = "正在导入飞书...";
    render();
    chrome.runtime.sendMessage({ type: "XHS_IMPORT_FEISHU", config, rows }, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) state.error = runtimeError.message;
      else if (!response || !response.ok) state.error = response && response.error || "导入飞书失败。";
      else {
        const result = response.data || {};
        const coverFailures = Array.isArray(result.coverFailures) ? result.coverFailures : [];
        state.error = "";
        state.message = `飞书导入完成：新增 ${result.created || 0} 条，跳过重复 ${result.skipped || 0} 条，封面图片成功 ${result.coverUploaded || 0} 张${coverFailures.length ? `，失败 ${coverFailures.length} 张（${coverFailures[0].title || "未命名笔记"}）` : ""}。`;
      }
      state.importingFeishu = false;
      render();
    });
  }

  function render() {
    const rows = displayRows();
    els.tabState.textContent = state.isXhs ? "小红书" : "不可用";
    els.summary.textContent = state.candidates.length ? `已采集 ${state.candidates.length} 条候选，筛选出 ${rows.length} 条` : "已采集 0 条候选笔记";
    els.scrollStatus.textContent = state.capturingDetails ? `正文抓取中：第 ${state.detailCurrent}/${state.detailTotal} 条` : state.running ? "正在自动滚动采集" : "先采集候选，再按条件筛选";
    els.pageHint.textContent = state.isXhs ? "请打开小红书博主主页采集全部笔记" : "当前页面不是小红书页面，请打开小红书博主主页";
    els.message.textContent = state.error || state.message || "";
    els.message.classList.toggle("error", Boolean(state.error));
    els.start.textContent = state.running ? "停止采集" : "开始采集博主笔记";
    els.start.disabled = !state.isXhs || state.capturingDetails;
    els.capture.disabled = !state.isXhs || rows.length === 0 || state.running;
    els.capture.textContent = state.capturingDetails ? "停止抓取" : "抓取正文";
    els.clear.disabled = !state.isXhs || (!state.running && !state.candidates.length);
    els.sort.disabled = rows.length < 2;
    els.sort.textContent = state.sortByLikes ? "恢复顺序" : "点赞排序";
    els.sort.classList.toggle("active", state.sortByLikes);
    els.export.disabled = rows.length === 0 || state.capturingDetails;
    els.importFeishu.disabled = rows.length === 0 || state.importingFeishu || state.capturingDetails;
    els.importFeishu.textContent = state.importingFeishu ? "导入中..." : "导入飞书";
    if (!rows.length) {
      els.list.innerHTML = '<div class="empty">暂无采集结果</div>';
      return;
    }
    els.list.innerHTML = rows.map((row, index) => {
      const title = escapeHtml(row.title || "未识别标题");
      const author = escapeHtml(row.author || state.author || "未识别作者");
      const likes = Number.isFinite(row.likes) ? String(row.likes) : "0";
      const hasContent = Boolean(String(row.content || "").trim());
      const status = row.detailStatus === "capturing" ? "抓取中..." : row.detailStatus === "done" && hasContent ? "正文已抓取" : row.detailStatus === "error" || row.detailStatus === "done" ? "正文抓取失败" : "";
      const cover = row.cover || row.coverUrl ? `<img class="thumb" src="${escapeHtml(row.cover || row.coverUrl)}" alt="">` : '<div class="thumb"></div>';
      return `<article class="item" data-note-url="${escapeHtml(row.url)}"><div class="rank">${index + 1}</div>${cover}<div class="meta"><div class="note-title" title="${title}">${title}</div><div class="note-author">${author}</div><div class="note-likes">${escapeHtml(row.noteForm || "图文")} · 点赞数: ${escapeHtml(likes)}${status ? ` · ${escapeHtml(status)}` : ""}</div></div><button class="delete" type="button" data-delete-url="${escapeHtml(row.url)}">删除</button></article>`;
    }).join("");
  }

  document.querySelectorAll("[data-page]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-page]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-page-section]").forEach((section) => section.classList.toggle("active", section.dataset.pageSection === button.dataset.page));
    });
  });
  els.start.addEventListener("click", () => state.running ? sendToActiveTab({ type: "XHS_STOP_COLLECT" }).catch((error) => { state.error = error.message; render(); }) : startCollect());
  els.capture.addEventListener("click", () => state.capturingDetails ? sendToActiveTab({ type: "XHS_STOP_DETAIL_CAPTURE" }).catch(() => {}) : captureDetails());
  els.clear.addEventListener("click", clearRows);
  els.export.addEventListener("click", exportExcel);
  els.importFeishu.addEventListener("click", importFeishu);
  els.saveFeishu.addEventListener("click", () => saveFeishuConfig().catch((error) => { els.feishuMessage.textContent = error.message; }));
  els.minLikes.addEventListener("input", () => { state.minLikes = Number.parseInt(els.minLikes.value, 10) || 0; render(); });
  els.keyword.addEventListener("input", () => { state.keyword = els.keyword.value; render(); });
  els.typeFilter.addEventListener("change", () => { state.typeFilter = els.typeFilter.value; render(); });
  els.sort.addEventListener("click", () => { state.sortByLikes = !state.sortByLikes; render(); });
  els.list.addEventListener("click", (event) => {
    const deleteButton = event.target.closest("[data-delete-url]");
    if (deleteButton) {
      deleteRow(deleteButton.dataset.deleteUrl);
      return;
    }
    const item = event.target.closest("[data-note-url]");
    if (item) {
      const row = findRow(item.dataset.noteUrl);
      if (row) openNote(row);
    }
  });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (!message || message.type !== "XHS_COLLECTOR_EVENT" || !sender.tab || sender.tab.id !== state.activeTabId) return;
    if (message.snapshot) applySnapshot(message.snapshot);
    if (message.event === "detail-progress" && message.payload) {
      const payload = message.payload;
      const index = state.candidates.findIndex((row) => row.url === payload.row.url);
      if (index >= 0) state.candidates[index] = { ...state.candidates[index], ...payload.row, detailStatus: payload.status, detailError: payload.error || "" };
      render();
    }
  });
  chrome.tabs.onActivated.addListener(() => syncActiveTab());
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === state.activeTabId && (changeInfo.status === "complete" || changeInfo.url)) syncActiveTab();
  });

  loadFeishuConfig().catch(() => {});
  syncActiveTab();
})();
