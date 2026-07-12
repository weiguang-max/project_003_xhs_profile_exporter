"use strict";

const FEISHU_API = "https://open.feishu.cn/open-apis";
const FEISHU_BATCH_SIZE = 500;
const REQUIRED_FIELDS = ["标题", "作者", "笔记形式", "点赞", "原文链接", "正文", "封面链接"];
const FEISHU_URL_FIELD_TYPE = 15;
const DEBUGGER_PROTOCOL_VERSION = "1.3";

async function sendToggle(tab) {
  if (!tab || !tab.id || !tab.url || !tab.url.startsWith("https://www.xiaohongshu.com/")) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tab.id, { type: "XHS_TOGGLE_PANEL" });
  } catch (_) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["vendor/xlsx.full.min.js", "note-utils.js", "content.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "XHS_TOGGLE_PANEL" });
  }
}

chrome.action.onClicked.addListener((tab) => {
  sendToggle(tab);
});

function parseBitableUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch (_) {
    throw new Error("飞书多维表格链接格式不正确。");
  }

  const appTokenMatch = url.pathname.match(/\/base\/([^/?#]+)/);
  const wikiTokenMatch = url.pathname.match(/\/wiki\/([^/?#]+)/);
  const appToken = appTokenMatch ? appTokenMatch[1] : "";
  const wikiToken = wikiTokenMatch ? wikiTokenMatch[1] : "";
  const tableId = url.searchParams.get("table") || "";

  if (!appToken && !wikiToken) {
    throw new Error("无法从飞书链接中识别 app_token 或 wiki token，请复制多维表格完整链接。");
  }
  if (!tableId) {
    throw new Error("飞书链接缺少 table 参数，请打开目标数据表后复制完整链接。");
  }

  return { appToken, wikiToken, tableId };
}

async function feishuRequest(path, options = {}) {
  const response = await fetch(`${FEISHU_API}${path}`, options);
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    // handled below
  }

  if (!response.ok) {
    throw new Error(`飞书接口请求失败：HTTP ${response.status}`);
  }
  if (!payload) {
    throw new Error("飞书接口返回为空。");
  }
  if (payload.code !== 0) {
    throw new Error(payload.msg || `飞书接口返回错误：${payload.code}`);
  }

  return payload;
}

async function getTenantAccessToken(config) {
  const payload = await feishuRequest("/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      app_id: config.appId,
      app_secret: config.appSecret,
    }),
  });
  if (!payload.tenant_access_token) {
    throw new Error("飞书未返回 tenant_access_token，请检查 App ID/Secret。");
  }
  return payload.tenant_access_token;
}

async function resolveBitableAppToken({ token, appToken, wikiToken }) {
  if (appToken) return appToken;
  const query = new URLSearchParams({ token: wikiToken });
  const payload = await feishuRequest(`/wiki/v2/spaces/get_node?${query}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const node = (payload.data || {}).node || {};
  if (!node.obj_token) {
    throw new Error("无法从飞书 wiki 链接解析多维表格 app_token，请确认链接指向多维表格。");
  }
  return node.obj_token;
}

async function readExistingUrls({ token, appToken, tableId }) {
  const existing = new Set();
  let pageToken = "";

  do {
    const query = new URLSearchParams({ page_size: "500" });
    if (pageToken) query.set("page_token", pageToken);

    const payload = await feishuRequest(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/search?${query}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ field_names: ["原文链接"] }),
      }
    );

    const data = payload.data || {};
    for (const item of data.items || []) {
      const url = extractFeishuUrl(item.fields && item.fields["原文链接"]);
      if (url) existing.add(url);
    }

    pageToken = data.has_more ? data.page_token || "" : "";
  } while (pageToken);

  return existing;
}

function extractFeishuUrl(value) {
  if (typeof value === "string") return value.trim();
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = extractFeishuUrl(item);
      if (result) return result;
    }
    return "";
  }
  if (typeof value === "object") {
    const link = value.link || value.url || value.text;
    return typeof link === "string" ? link.trim() : "";
  }
  return "";
}

async function readFieldTypes({ token, appToken, tableId }) {
  const fields = new Map();
  let pageToken = "";

  do {
    const query = new URLSearchParams({ page_size: "100" });
    if (pageToken) query.set("page_token", pageToken);

    const payload = await feishuRequest(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?${query}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    const data = payload.data || {};
    for (const item of data.items || []) {
      if (item.field_name) fields.set(item.field_name, item.type);
    }
    pageToken = data.has_more ? data.page_token || "" : "";
  } while (pageToken);

  const missing = REQUIRED_FIELDS.filter((field) => !fields.has(field));
  if (missing.length) {
    throw new Error(`飞书表缺少字段：${missing.join("、")}`);
  }

  return fields;
}

function uniqueRows(rows) {
  const seen = new Set();
  const result = [];
  for (const row of rows || []) {
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({
      title: row.title || "",
      author: row.author || "",
      noteForm: row.noteForm || "图文",
      likes: Number.isFinite(row.likes) ? row.likes : "",
      url,
      content: String(row.content || ""),
      coverUrl: String(row.coverUrl || ""),
    });
  }
  return result;
}

function formatOriginalLink(url, fieldTypes) {
  if (fieldTypes.get("原文链接") === FEISHU_URL_FIELD_TYPE) {
    return { text: url, link: url };
  }
  return url;
}

async function batchCreateRecords({ token, appToken, tableId, rows, fieldTypes }) {
  let created = 0;
  for (let index = 0; index < rows.length; index += FEISHU_BATCH_SIZE) {
    const chunk = rows.slice(index, index + FEISHU_BATCH_SIZE);
    const records = chunk.map((row) => ({
      fields: {
        标题: row.title,
        作者: row.author,
        笔记形式: row.noteForm,
        点赞: row.likes,
        原文链接: formatOriginalLink(row.url, fieldTypes),
        正文: row.content,
        封面链接: row.coverUrl,
      },
    }));

    const payload = await feishuRequest(
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/batch_create`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ records }),
      }
    );
    created += ((payload.data || {}).records || records).length;
  }
  return created;
}

async function importFeishu(message) {
  const config = message.config || {};
  if (!config.appId || !config.appSecret || !config.bitableUrl) {
    throw new Error("请先填写并保存飞书 App ID、App Secret 和多维表格链接。");
  }

  const parsed = parseBitableUrl(config.bitableUrl);
  const token = await getTenantAccessToken(config);
  const appToken = await resolveBitableAppToken({ token, appToken: parsed.appToken, wikiToken: parsed.wikiToken });
  const tableId = parsed.tableId;
  const fieldTypes = await readFieldTypes({ token, appToken, tableId });
  const rows = uniqueRows(message.rows || []);
  if (!rows.length) {
    return { created: 0, skipped: 0, total: 0 };
  }

  const existingUrls = await readExistingUrls({ token, appToken, tableId });
  const newRows = rows.filter((row) => !existingUrls.has(row.url));
  const created = newRows.length
    ? await batchCreateRecords({ token, appToken, tableId, rows: newRows, fieldTypes })
    : 0;

  return {
    created,
    skipped: rows.length - newRows.length,
    total: rows.length,
  };
}

async function dispatchRealMouseClick(tabId, point) {
  if (!Number.isFinite(point && point.x) || !Number.isFinite(point && point.y)) {
    throw new Error("笔记卡片坐标无效。");
  }

  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, DEBUGGER_PROTOCOL_VERSION);
    attached = true;
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      buttons: 0,
      pointerType: "mouse",
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 1,
      clickCount: 1,
      pointerType: "mouse",
    });
    await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: point.x,
      y: point.y,
      button: "left",
      buttons: 0,
      clickCount: 1,
      pointerType: "mouse",
    });
  } finally {
    if (attached) {
      await chrome.debugger.detach(target).catch(() => {});
    }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;

  if (message.type === "XHS_REAL_MOUSE_CLICK") {
    const tabId = _sender && _sender.tab ? _sender.tab.id : 0;
    if (!tabId) {
      sendResponse({ ok: false, error: "无法识别当前小红书标签页。" });
      return false;
    }
    dispatchRealMouseClick(tabId, message.point)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "XHS_IMPORT_FEISHU") {
    importFeishu(message)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type !== "XHS_DOWNLOAD_XLSX") return false;

  const filename = message.filename || "xiaohongshu_notes.xlsx";
  const base64 = message.base64 || "";
  const url =
    "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," +
    base64;

  chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
    const error = chrome.runtime.lastError;
    if (error) {
      sendResponse({ ok: false, error: error.message });
      return;
    }
    sendResponse({ ok: true, downloadId });
  });

  return true;
});
