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
const feishuSandbox = { globalThis: null, URL };
feishuSandbox.globalThis = feishuSandbox;
vm.runInNewContext(feishuSource, feishuSandbox, { filename: "feishu-utils.js" });
const feishuUtils = feishuSandbox.XHS_FEISHU_UTILS || {};

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
        { currentSrc: "https://img.example/cover-full.jpg", src: "https://img.example/cover-thumb.jpg" },
        { currentSrc: "https://img.example/second.jpg", src: "https://img.example/second-thumb.jpg" },
      ];
    }
    return [];
  },
  querySelector(selector) {
    if (selector === "#detail-title") return { textContent: "笔记标题" };
    if (selector === ".bottom-container .date") return { textContent: "07-02" };
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
    原文链接: { text: "https://xhs.example/note", link: "https://xhs.example/note" },
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

console.log("note-utils tests passed");
