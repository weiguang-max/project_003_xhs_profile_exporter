"use strict";

(() => {
  const COVER_ATTACHMENT_FIELD_NAME = "封面";
  const ATTACHMENT_FIELD_TYPE = 17;

  function findCoverAttachmentField(fieldTypes) {
    return fieldTypes && fieldTypes.get(COVER_ATTACHMENT_FIELD_NAME) === ATTACHMENT_FIELD_TYPE
      ? COVER_ATTACHMENT_FIELD_NAME
      : "";
  }

  function buildAttachmentValue(fileToken, fileName) {
    return [{ file_token: fileToken, name: fileName }];
  }

  function buildFeishuRecordFields(row, originalLink, coverAttachment) {
    const fields = {
      标题: row.title,
      作者: row.author,
      笔记形式: row.noteForm,
      点赞: Number.isFinite(row.likes) ? row.likes : 0,
      发布时间: row.publishTime || "",
      原文链接: originalLink,
      正文: row.content,
    };
    if (coverAttachment) fields[COVER_ATTACHMENT_FIELD_NAME] = coverAttachment;
    return fields;
  }

  function getFeishuImportBlockMessage(rows) {
    return Array.isArray(rows) && rows.length ? "" : "没有可导入的数据。";
  }

  function fileNameFromImageUrl(rawUrl, contentType) {
    const fallbackExtension = String(contentType || "image/jpeg").split("/")[1] || "jpeg";
    try {
      const pathname = new URL(rawUrl).pathname;
      const lastSegment = decodeURIComponent(pathname.split("/").pop() || "");
      const match = lastSegment.match(/^([\w.-]+\.(?:avif|bmp|gif|heic|jpeg|jpg|png|webp))$/i);
      if (match) return match[1].replace(/[^\w.-]/g, "_").slice(0, 180);
    } catch (_) {
      // use fallback below
    }
    return `xiaohongshu-cover.${fallbackExtension.replace(/[^a-z0-9]/gi, "") || "jpeg"}`;
  }

  globalThis.XHS_FEISHU_UTILS = {
    findCoverAttachmentField,
    buildAttachmentValue,
    buildFeishuRecordFields,
    getFeishuImportBlockMessage,
    fileNameFromImageUrl,
  };
})();
