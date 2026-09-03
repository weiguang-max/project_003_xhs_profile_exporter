# 关键词筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a case-insensitive title/body keyword filter whose result set drives the panel, Excel export, and Feishu import.

**Architecture:** Reuse the browser-independent `extension/note-utils.js` loaded by the Side Panel for a small `matchesKeyword(row, keyword)` predicate. `sidepanel.js` will add the keyword to its existing `filteredRows()` pipeline; because exports and Feishu imports already call `displayRows()` through `rowsForExternalUse()`, they will automatically use the filtered result.

**Tech Stack:** Chrome MV3 Side Panel, plain JavaScript/CSS, Node.js assertions, ZIP packaging.

---

### Task 1: Add the keyword matching test

**Files:**
- Modify: `tests/note-utils.test.js`
- Test: `extension/note-utils.js` through the existing VM test harness

- [ ] **Step 1: Write the failing tests**

Add assertions for the expected predicate:

```js
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, ""), true);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, "耳钉"), true);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, "材质"), true);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "银色材质" }, "SILVER"), false);
assert.equal(utils.matchesKeyword({ title: "春日耳钉", content: "silver" }, "SILVER"), true);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/note-utils.test.js`

Expected: FAIL because `utils.matchesKeyword` is not defined.

### Task 2: Implement and wire keyword filtering

**Files:**
- Modify: `extension/note-utils.js`
- Modify: `extension/sidepanel.html`
- Modify: `extension/sidepanel.js`
- Modify: `extension/sidepanel.css`

- [ ] **Step 1: Add the minimal matching helper**

Expose this browser-independent function from `XHS_NOTE_UTILS`:

```js
function matchesKeyword(row, keyword) {
  const normalizedKeyword = String(keyword || "").trim().toLowerCase();
  if (!normalizedKeyword) return true;
  return [row && row.title, row && row.content]
    .some((value) => String(value || "").toLowerCase().includes(normalizedKeyword));
}
```

- [ ] **Step 2: Run the tests to verify the helper passes**

Run: `node tests/note-utils.test.js`

Expected: PASS.

- [ ] **Step 3: Add the Side Panel input**

Load `note-utils.js` before `sidepanel.js` in `extension/sidepanel.html`, add a text input with id `keyword`, and keep its placeholder explicit: `标题或正文关键词`.

- [ ] **Step 4: Add keyword state and filtering**

Add `keyword: ""` to Side Panel state, bind `els.keyword`, update it on `input`, and add `NOTE_UTILS.matchesKeyword(row, state.keyword)` to the existing `filteredRows()` predicate. Do not change the existing likes/type/sort behavior.

- [ ] **Step 5: Style the input for variable Side Panel widths**

Add a `.keyword-field` rule using one full-width grid column and left-aligned input text so it does not inherit the numeric field’s fixed-width layout.

### Task 3: Verify filtered exports and package the extension

**Files:**
- Modify: `extension.zip`
- Verify: `README.md` behavior remains consistent with filtered exports

- [ ] **Step 1: Verify the export path uses filtered rows**

Confirm `exportExcel()` and `importFeishu()` call `rowsForExternalUse()`, and that `rowsForExternalUse()` calls `displayRows()`. No separate export filter is needed.

- [ ] **Step 2: Run full validation**

Run:

```bash
node --check extension/note-utils.js
node --check extension/sidepanel.js
node tests/note-utils.test.js
git diff --check
```

Expected: all commands exit 0 and the test prints `note-utils tests passed`.

- [ ] **Step 3: Rebuild and verify the unpacked extension archive**

Run:

```bash
rm -f /private/tmp/xhs-extension.zip
zip -qr /private/tmp/xhs-extension.zip extension -x '*.DS_Store'
cp /private/tmp/xhs-extension.zip extension.zip
unzip -tq extension.zip
```

Expected: `No errors detected in compressed data of extension.zip.`

- [ ] **Step 4: Do not commit or push**

Leave the changes in the working tree for the user to test, following the user’s explicit Git preference.
