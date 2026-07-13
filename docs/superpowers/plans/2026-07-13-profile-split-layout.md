# 博主主页分屏布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让采集工具占用右侧固定列，并让小红书主容器在剩余宽度内重新排版，关闭工具后恢复页面。

**Architecture:** 继续使用当前标签页中的 Shadow DOM 采集面板。打开面板时同时约束 `body` 和小红书 `#app` 的宽度、最小宽度和横向溢出；保存这些元素的原始内联样式，关闭时恢复。采集和详情逻辑不变。

**Tech Stack:** Chrome MV3 content script, Shadow DOM, plain JavaScript, Node.js syntax/unit checks, ZIP packaging.

---

### Task 1: Extend split-layout style bookkeeping

**Files:**
- Modify: `extension/content.js:47,356-382`
- Test: existing `tests/note-utils.test.js` plus syntax checks

- [x] **Step 1: Record the additional styles that must be restored**

Add `minWidth` to the saved body style object and add a saved root-container style object for `#app`.

- [x] **Step 2: Run the existing checks before implementation**

Run: `node tests/note-utils.test.js && node --check extension/content.js`

Expected: `note-utils tests passed` and no syntax errors.

- [x] **Step 3: Apply split styles to both page layers**

In `applySplitLayout()`, find `document.querySelector("#app")`, set its `width` and `max-width` to `calc(100vw - ${PANEL_WIDTH}px)`, set `min-width: 0`, `box-sizing: border-box`, and set `overflow-x: hidden` on the document root. The body remains the layer that subtracts `PANEL_WIDTH`; save each changed inline style before overriding it.

- [x] **Step 4: Restore both page layers**

In `restoreSplitLayout()`, restore every saved body and `#app` property, including the case where `#app` was not present when the panel opened.

- [x] **Step 5: Run checks**

Run: `node tests/note-utils.test.js && node --check extension/content.js && git diff --check`

Expected: all checks pass with no whitespace errors.

### Task 2: Package and verify the split layout

**Files:**
- Modify: `extension.zip`

- [x] **Step 1: Rebuild the extension package**

Run: `zip -qrFS extension.zip extension -x 'extension/.DS_Store'`

- [x] **Step 2: Validate the package and scripts**

Run: `node tests/note-utils.test.js && node --check extension/note-utils.js && node --check extension/content.js && node --check extension/background.js && unzip -tq extension.zip`

Expected: unit test passes and `No errors detected in compressed data of extension.zip.`

- [x] **Step 3: Commit the design and implementation**

Run: `git add docs/superpowers/specs/2026-07-13-profile-split-layout-design.md docs/superpowers/plans/2026-07-13-profile-split-layout.md extension/content.js extension.zip && git commit -m "feat: improve profile split layout"`
