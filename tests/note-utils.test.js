"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../extension/note-utils.js"), "utf8");
const sandbox = { globalThis: null, URL };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "note-utils.js" });

const utils = sandbox.XHS_NOTE_UTILS;

const feishuSourcePath = path.join(__dirname, "../extension/feishu-utils.js");
const feishuSource = fs.existsSync(feishuSourcePath) ? fs.readFileSync(feishuSourcePath, "utf8") : "";
const drawCalls = [];
const fakeBitmap = { width: 2, height: 3, close() { drawCalls.push(["close"]); } };
const fakeContext = {
  fillStyle: "",
  fillRect(...args) { drawCalls.push(["fillRect", ...args]); },
  drawImage(...args) { drawCalls.push(["drawImage", ...args]); },
};
const fakeCanvas = {
  getContext() { return fakeContext; },
  convertToBlob(options) {
    drawCalls.push(["convertToBlob", options]);
    return Promise.resolve({ type: "image/jpeg", size: 42 });
  },
};
const feishuSandbox = {
  globalThis: null,
  URL,
  createImageBitmap: async () => fakeBitmap,
  OffscreenCanvas: function OffscreenCanvas(width, height) {
    drawCalls.push(["canvas", width, height]);
    return fakeCanvas;
  },
};
feishuSandbox.globalThis = feishuSandbox;
vm.runInNewContext(feishuSource, feishuSandbox, { filename: "feishu-utils.js" });
const feishuUtils = feishuSandbox.XHS_FEISHU_UTILS || {};
const sidepanelHtml = fs.readFileSync(path.join(__dirname, "../extension/sidepanel.html"), "utf8");
const sidepanelSource = fs.readFileSync(path.join(__dirname, "../extension/sidepanel.js"), "utf8");
const sidepanelCss = fs.readFileSync(path.join(__dirname, "../extension/sidepanel.css"), "utf8");

assert.match(sidepanelHtml, /id="openFeishuBitable"/);
assert.match(sidepanelSource, /chrome\.tabs\.create\(\{ url \}\)/);
assert.match(sidepanelCss, /\.toolbar select[\s\S]*text-align-last:\s*center/);

assert.equal(
  utils.noteIdFromUrl("https://www.xiaohongshu.com/user/profile/author/6a2d40180000000036000abb?xsec_token=test"),
  "6a2d40180000000036000abb"
);

const detailRoot = {
  querySelectorAll(selector) {
    if (selector === "#detail-desc .note-text") {
      return [{ textContent: "第一段" }, { textContent: "第二段" }];
    }
    if (selector === "#noteContainer .media-container img") {
      return [
        { currentSrc: "https://img.example/last.jpg", src: "https://img.example/last-thumb.jpg" },
        { currentSrc: "https://img.example/second.jpg", src: "https://img.example/second-thumb.jpg" },
        { currentSrc: "https://img.example/cover-full.jpg", src: "https://img.example/cover-thumb.jpg" },
      ];
    }
    return [];
  },
  querySelector(selector) {
    if (selector === "#detail-title") return { textContent: "笔记标题" };
    if (selector === ".bottom-container .date") return { textContent: "07-02" };
    if (
      selector ===
      '#noteContainer .note-slider .swiper-slide-active:not(.swiper-slide-duplicate), #noteContainer .note-slider .swiper-slide[data-swiper-slide-index="0"]:not(.swiper-slide-duplicate)'
    ) {
      return {
        querySelector(query) {
          if (query === ".note-slider-img" || query === "img") {
            return { currentSrc: "https://img.example/cover-full.jpg", src: "https://img.example/cover-thumb.jpg" };
          }
          return null;
        },
      };
    }
    return null;
  },
};

assert.equal(utils.extractDetailText(detailRoot), "第一段\n第二段");
assert.equal(utils.detailContentReady(detailRoot), true);
assert.equal(utils.detailContentReady({ querySelectorAll: () => [] }), false);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, ""), true);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, "耳钉"), true);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, "材质"), true);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, "SILVER"), false);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "silver" }, "SILVER"), true);
assert.equal(utils.extractCoverUrl(detailRoot), "https://img.example/cover-full.jpg");
assert.equal(utils.extractPublishTime(detailRoot), "07-02");
assert.equal(utils.extractPublishTime({ querySelector: () => null }), "");
assert.deepEqual(JSON.parse(JSON.stringify(utils.extractDetailData(detailRoot))), {
  title: "笔记标题",
  content: "第一段\n第二段",
  coverUrl: "https://img.example/cover-full.jpg",
  publishTime: "07-02",
});

assert.deepEqual(
  JSON.parse(JSON.stringify(utils.clickPointFromElement({
    getBoundingClientRect() {
      return { left: 10, top: 20, width: 100, height: 50 };
    },
  }))),
  { x: 60, y: 45 }
);

assert.deepEqual(
  JSON.parse(JSON.stringify(utils.clickPointFromAnchor(
    {
      querySelector() {
        return null;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 0, height: 0 };
      },
    },
    {
      querySelector() {
        return {
          getBoundingClientRect() {
            return { left: 30, top: 40, width: 80, height: 60 };
          },
        };
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 0, height: 0 };
      },
    }
  ))),
  { x: 70, y: 70 }
);

assert.equal(
  feishuUtils.findCoverAttachmentField(new Map([["封面", 17]])),
  "封面"
);
const noteUrlFromSearch = "https://www.xiaohongshu.com/explore/6a910420000000002501a389?xsec_token=search-token&xsec_source=pc_search&m_source=mengfanwetab";
const noteUrlFromUser = "https://www.xiaohongshu.com/explore/6a910420000000002501a389?xsec_token=user-token&xsec_source=pc_user";
assert.equal(feishuUtils.noteKeyFromUrl(noteUrlFromSearch), feishuUtils.noteKeyFromUrl(noteUrlFromUser));
assert.equal(feishuUtils.noteKeyFromUrl(noteUrlFromSearch), "note:6a910420000000002501a389");
assert.equal(
  feishuUtils.noteKeyFromUrl("https://www.xiaohongshu.com/user/profile/author/6a910420000000002501a389?xsec_token=another-token"),
  "note:6a910420000000002501a389"
);
assert.equal(
  feishuUtils.noteKeyFromUrl("https://example.com/article?id=1#section"),
  "url:https://example.com/article?id=1"
);
assert.equal(
  feishuUtils.findCoverAttachmentField(new Map([["封面", 1]])),
  ""
);
assert.equal(
  feishuUtils.findCoverAttachmentField(new Map([["封面图片", 17]])),
  ""
);
assert.deepEqual(
  JSON.parse(JSON.stringify(feishuUtils.buildAttachmentValue("file-token-1", "cover.webp"))),
  [{ file_token: "file-token-1", name: "cover.webp" }]
);
assert.deepEqual(
  JSON.parse(JSON.stringify(feishuUtils.buildFeishuRecordFields(
    {
      title: "标题",
      author: "作者",
      noteForm: "图文",
      likes: 12,
      content: "正文",
      publishTime: "07-02",
    },
    { text: "https://xhs.example/note", link: "https://xhs.example/note" },
    [{ file_token: "file-token-1", name: "cover.webp" }]
  ))),
  {
    标题: "标题",
    作者: "作者",
    笔记形式: "图文",
    点赞: 12,
    原文链接: { text: "原文链接", link: "https://xhs.example/note" },
    正文: "正文",
    发布时间: "07-02",
    封面: [{ file_token: "file-token-1", name: "cover.webp" }],
  }
);
assert.equal(
  feishuUtils.buildFeishuRecordFields(
    { title: "无点赞", author: "作者", noteForm: "图文", likes: "", content: "正文" },
    "https://xhs.example/note",
    null
  ).点赞,
  0
);
assert.equal(feishuUtils.getFeishuImportBlockMessage([
  { content: "" },
  { content: "", detailStatus: "done" },
  { content: "", detailStatus: "error" },
]), "");
assert.equal(
  feishuUtils.fileNameFromImageUrl("https://img.example/path/cover.webp?x=1", "image/webp"),
  "cover.webp"
);
assert.equal(
  feishuUtils.fileNameFromImageUrl("not-a-url", "image/jpeg"),
  "xiaohongshu-cover.jpeg"
);
assert.equal(
  feishuUtils.jpegFileNameFromImageUrl("https://img.example/path/cover.webp?x=1"),
  "cover.jpg"
);

(async () => {
  const converted = await feishuUtils.convertImageBlobToJpeg({ type: "image/webp", size: 10 });
  assert.equal(converted.type, "image/jpeg");
  assert.equal(converted.size, 42);
  assert.deepEqual(drawCalls[0], ["canvas", 2, 3]);
  assert.deepEqual(drawCalls[1], ["fillRect", 0, 0, 2, 3]);
  assert.equal(drawCalls[2][0], "drawImage");
  assert.equal(drawCalls[2][1], fakeBitmap);
  assert.deepEqual(drawCalls[2].slice(2), [0, 0, 2, 3]);
  assert.equal(drawCalls[3][0], "convertToBlob");
  assert.deepEqual(JSON.parse(JSON.stringify(drawCalls[3][1])), { type: "image/jpeg", quality: 0.9 });
  assert.deepEqual(drawCalls[4], ["close"]);
  console.log("note-utils tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
