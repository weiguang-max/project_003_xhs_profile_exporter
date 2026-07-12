# Note Detail Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add same-page note-detail extraction, list-item positioning, and正文/封面链接 export to the XHS profile exporter.

**Architecture:** Keep the existing single content script and Shadow DOM panel. Add a small browser-independent utility script for URL, detail-DOM extraction, and card coordinate calculation. The content script sends the card center to the service worker, which briefly attaches `chrome.debugger` and sends CDP mouse input before detaching; the serial state machine then reads the current detail overlay, closes it, and updates each row. Extend the existing Excel and Feishu mappings without introducing private API calls.

**Tech Stack:** Chrome Manifest V3, plain JavaScript, Shadow DOM, Node built-in `assert` test runner, bundled SheetJS.

---

### Task 1: Add failing extraction tests

**Files:**
- Create: `tests/note-utils.test.js`
- Test: `extension/note-utils.js` (must not exist yet when the RED test runs)

- [ ] **Step 1: Write the failing test**

Test `noteIdFromUrl`, `extractDetailText`, and `extractCoverUrl` using small fake DOM roots. Assert that profile note URLs produce the note ID, multiple `.note-text` nodes are joined with newlines, and the first detail image prefers `currentSrc` over `src`.

- [ ] **Step 2: Run the test to verify it fails**

Run `node tests/note-utils.test.js`.

Expected: fail because `extension/note-utils.js` is not available.

### Task 2: Implement the extraction utility

**Files:**
- Create: `extension/note-utils.js`
- Modify: `extension/manifest.json`
- Test: `tests/note-utils.test.js`

- [ ] **Step 1: Implement only the tested helpers**

Expose `globalThis.XHS_NOTE_UTILS` with `noteIdFromUrl`, `extractDetailText`, `extractCoverUrl`, and `extractDetailData`. Keep it browser-compatible and avoid module syntax because Manifest V3 content scripts are classic scripts.

- [ ] **Step 2: Run the focused test**

Run `node tests/note-utils.test.js`.

Expected: all utility tests pass.

- [ ] **Step 3: Load the utility before the content script**

Add `note-utils.js` before `content.js` in `manifest.json` and keep the existing XLSX load order intact.

### Task 3: Add same-page detail interaction and serial capture

**Files:**
- Modify: `extension/content.js`
- Test: `tests/note-utils.test.js`

- [ ] **Step 1: Add row data and capture state**

Add `content`, `coverUrl`, `detailStatus`, and `detailError` to rows. Add `capturingDetails`, current index, and a run token to state.

- [ ] **Step 2: Add DOM lookup and real-input helpers**

Implement note-anchor lookup by normalized note ID, calculate its viewport center, request a background `chrome.debugger` click, poll for a visible matching `.note-detail-mask[note-id]`, and close the overlay through `.close-circle`/`.close-box` with Escape fallback.

- [ ] **Step 3: Add list-item opening**

Make each result article carry its note URL and handle article clicks separately from the delete button. Scroll the matched profile card into view and trigger its click.

- [ ] **Step 4: Add serial capture**

Add a toolbar action that loops over `displayRows()` in order, opens one detail at a time, extracts content and cover URL, closes the overlay, records success/failure, and stops safely when the user clicks the action again.

- [ ] **Step 5: Verify syntax and utility behavior**

Run `node tests/note-utils.test.js` and `node --check extension/note-utils.js && node --check extension/content.js`.

### Task 4: Extend Excel and Feishu outputs

**Files:**
- Modify: `extension/content.js`
- Modify: `extension/background.js`
- Modify: `README.md`
- Modify: `extension/manifest.json`

- [ ] **Step 1: Extend shared row mapping**

Include `content` as `正文` and `coverUrl` as `封面链接` in exported/imported rows.

- [ ] **Step 2: Extend Excel columns**

Append `正文` and `封面链接` to the worksheet headers and set readable column widths.

- [ ] **Step 3: Extend Feishu validation and batch creation**

Require the two new fields and send them in `batch_create` records. Existing tables without these fields should receive a clear missing-field error.

- [ ] **Step 4: Update user-facing documentation and version**

Document the new button, fields, same-page behavior, URL-only cover handling, and debugger permission. Bump the extension version to `0.3.0`.

### Task 5: Package and verify the release

**Files:**
- Modify: `extension.zip`

- [ ] **Step 1: Build the extension archive**

Run `zip -qrFS extension.zip extension -x 'extension/.DS_Store'`.

- [ ] **Step 2: Run final checks**

Run `node tests/note-utils.test.js`, syntax checks for all three extension scripts, inspect `git diff --check`, and verify the archive contains `note-utils.js`.

- [ ] **Step 3: Review the diff**

Confirm only the requested extraction, positioning, export, Feishu, docs, manifest, tests, and package changes are present.
