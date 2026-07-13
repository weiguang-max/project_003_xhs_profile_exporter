# Feishu Image Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import each captured Xiaohongshu cover image into a Feishu Bitable attachment field while preserving the original cover URL.

**Architecture:** The background service worker downloads cover URLs permitted by the XHS CDN host permission, uploads the binary to Feishu as a Bitable media asset, and writes the returned `file_token` into the `封面` attachment field. A failed cover upload does not prevent its record from being created; the Side Panel reports the failure count.

**Tech Stack:** Chrome MV3 service worker, `fetch`, `FormData`, Feishu Bitable and Drive media APIs, Node assertion tests.

---

### Task 1: Test attachment mapping helpers

**Files:**
- Modify: `tests/note-utils.test.js`
- Create: `extension/feishu-utils.js`

- [x] **Step 1: Write the failing test** for recognizing a type-17 `封面` field and creating the attachment value shape.
- [x] **Step 2: Run `node tests/note-utils.test.js`** and verify it fails because the helpers do not exist.
- [x] **Step 3: Add the minimal helpers** and expose them as `XHS_FEISHU_UTILS`.
- [x] **Step 4: Run `node tests/note-utils.test.js`** and verify it passes.

### Task 2: Connect Feishu image upload

**Files:**
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`

- [x] Load the helper file in the classic MV3 service worker.
- [x] Require `封面` to exist and be attachment type 17.
- [x] Download each cover image, upload it through `/drive/v1/medias/upload_all` with `parent_type=bitable_file`, and write its `file_token` into the record.
- [x] Keep creating records when an individual image fails and collect failure details.
- [x] Add the narrow `https://*.xhscdn.com/*` host permission.

### Task 3: Surface results and document setup

**Files:**
- Modify: `extension/sidepanel.js`
- Modify: `README.md`

- [x] Show successful and failed cover upload counts after import.
- [x] Document the required `封面` attachment field and image-upload failure behavior.

### Task 4: Verify package

**Files:**
- Modify: `extension.zip`

- [x] Run syntax checks, tests, manifest checks, archive checks, and `git diff --check`.
- [x] Rebuild `extension.zip` only after source checks pass.
