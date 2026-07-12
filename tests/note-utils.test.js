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
    return null;
  },
};

assert.equal(utils.extractDetailText(detailRoot), "第一段\n第二段");
assert.equal(utils.detailContentReady(detailRoot), true);
assert.equal(utils.detailContentReady({ querySelectorAll: () => [] }), false);
assert.equal(utils.extractCoverUrl(detailRoot), "https://img.example/cover-full.jpg");
assert.deepEqual(JSON.parse(JSON.stringify(utils.extractDetailData(detailRoot))), {
  title: "笔记标题",
  content: "第一段\n第二段",
  coverUrl: "https://img.example/cover-full.jpg",
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

console.log("note-utils tests passed");
