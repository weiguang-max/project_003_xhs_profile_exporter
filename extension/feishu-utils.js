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
    const originalLinkValue = originalLink && typeof originalLink === "object" && originalLink.link
      ? { ...originalLink, text: "原文链接" }
      : originalLink;
    const fields = {
      标题: row.title,
      作者: row.author,
      笔记形式: row.noteForm,
      点赞: Number.isFinite(row.likes) ? row.likes : 0,
      发布时间: row.publishTime || "",
      原文链接: originalLinkValue,
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

  function jpegFileNameFromImageUrl(rawUrl) {
    return fileNameFromImageUrl(rawUrl, "image/jpeg").replace(/\.[^.]+$/, ".jpg");
  }

  async function convertImageBlobToJpeg(blob) {
    if (!blob || !blob.size) {
      throw new Error("封面图片为空。");
    }

    const bitmap = await globalThis.createImageBitmap(blob);
    try {
      const canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, bitmap.width, bitmap.height);
      context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height);

      const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
      if (!jpeg || !jpeg.size) {
        throw new Error("封面图片转换 JPG 失败。");
      }
      return jpeg;
    } finally {
      if (typeof bitmap.close === "function") bitmap.close();
    }
  }

  globalThis.XHS_FEISHU_UTILS = {
    findCoverAttachmentField,
    buildAttachmentValue,
    buildFeishuRecordFields,
    getFeishuImportBlockMessage,
    fileNameFromImageUrl,
    jpegFileNameFromImageUrl,
    convertImageBlobToJpeg,
  };
})();
