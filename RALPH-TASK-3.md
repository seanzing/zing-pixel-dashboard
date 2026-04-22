# Ralph Loop Task 3 — Pixel Editor: Persist All Edits + Save Before Deploy

## Overview

Fix the remaining P0 and P1 issues in the Pixel Dashboard editor:

1. **P0: fontSize and textAlign don't persist** — same root cause as the font family revert bug fixed in commit `467c2d2`. They mutate the live DOM but never update `localPages`, so blob rebuilds revert them.

2. **P0: execCommand changes (bold/italic/color) may not be in localPages at deploy time** — if the user edits text and hits "Deploy" without clicking elsewhere in the iframe first, `saveCurrentEdit()` never fires, so `localPages` has stale HTML.

3. **P1: Save in-progress edit before deploy** — `deployLocalHtml` and `deployAllPages` must flush any active editing session before deploying.

4. **P1: Escape key should end editing** — already wired in keydown handler but confirm it fires `saveCurrentEdit()` which sends `PIXEL_TEXT_END` and updates toolbar state.

---

## File Locations

- `app/dashboard/sites/[siteId]/page.tsx` — injection script + deploy functions + message handler
- `components/PixelToolbar.tsx` — toolbar command functions

---

## Fix 1: Expose `_pixelApplyStyle` in the injection script

In `page.tsx`, alongside the existing `window._pixelApplyFontFamily`, add a general style-apply function:

```javascript
// Called by parent for style-only changes (fontSize, textAlign, color on element).
// Applies style inline and sends PIXEL_TEXT_CHANGE so localPages stays in sync.
window._pixelApplyStyle = function(prop, value) {
  if (!_editingEl) return;
  _editingEl.style[prop] = value;
  var newHtml = cleanHtml(_editingEl);
  if (newHtml !== _editingOrigHtml) {
    window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:_editingOrigHtml, newHtml:newHtml, needsRebuild:false }, '*');
    _editingOrigHtml = newHtml;
  }
};
```

Add it immediately after `window._pixelApplyFontFamily` (around line 278).

---

## Fix 2: Update `applyFontSize` and `applyAlign` in PixelToolbar.tsx

Replace the current direct DOM mutations with calls to `_pixelApplyStyle`:

```typescript
function applyFontSize(size: number) {
  const iframeWin = getIframeWin() as any;
  if (typeof iframeWin?._pixelApplyStyle === "function") {
    iframeWin._pixelApplyStyle("fontSize", size + "px");
  }
}

function applyAlign(align: string) {
  const iframeWin = getIframeWin() as any;
  if (typeof iframeWin?._pixelApplyStyle === "function") {
    iframeWin._pixelApplyStyle("textAlign", align);
  }
}
```

---

## Fix 3: Expose `_pixelSaveEdit` in the injection script

The parent needs a way to flush an in-progress edit before deploying:

```javascript
// Called by parent before deploying to ensure any in-progress edit is saved to localPages.
window._pixelSaveEdit = function() {
  if (_editingEl) saveCurrentEdit();
};
```

Add this immediately after `window._pixelApplyStyle`.

---

## Fix 4: Call `_pixelSaveEdit` before deploying

In `page.tsx`, update BOTH `deployLocalHtml` and `deployAllPages` to flush the active edit first.

### `deployLocalHtml` — add flush at the top:

```typescript
async function deployLocalHtml() {
  if (!localHtml || !isDirty) return;
  // Flush any in-progress text edit so localPages has the latest content
  const iframeWin = iframeRef.current?.contentWindow as any;
  if (typeof iframeWin?._pixelSaveEdit === "function") iframeWin._pixelSaveEdit();
  // Small delay to allow PIXEL_TEXT_CHANGE to update localPages state before reading it
  await new Promise(r => setTimeout(r, 80));
  setHtmlDeploying(true);
  try {
    const sha = await deployPage(currentPage);
    if (sha) pollDeployStatus(sha);
  } catch (err) {
    alert((err as Error).message);
  } finally {
    setHtmlDeploying(false);
  }
}
```

### `deployAllPages` — add flush at the top:

```typescript
async function deployAllPages() {
  if (dirtyCount === 0) return;
  // Flush any in-progress text edit first
  const iframeWin = iframeRef.current?.contentWindow as any;
  if (typeof iframeWin?._pixelSaveEdit === "function") iframeWin._pixelSaveEdit();
  await new Promise(r => setTimeout(r, 80));
  setHtmlDeploying(true);
  // ... rest unchanged
```

---

## Fix 5: Also persist `clearFormatting` via `_pixelSaveEdit`

The `clearFormatting()` function in PixelToolbar calls `execCommand('removeFormat')` and clears inline styles — but never notifies the iframe's injection script to update `_editingOrigHtml`. After clearing, a blob rebuild would revert the cleared state.

After `clearFormatting` applies all its changes, trigger a save via the iframe:

```typescript
function clearFormatting() {
  if (!restoreIframeFocus()) return;
  const doc = getIframeDoc();
  const el = getEditingEl();
  if (!doc || !el) return;
  doc.execCommand('removeFormat');
  el.querySelectorAll('span[style*="color"],font[color]').forEach((n) => {
    const p = n.parentNode;
    if (!p) return;
    while (n.firstChild) p.insertBefore(n.firstChild, n);
    p.removeChild(n);
  });
  try { el.normalize(); } catch { /* noop */ }
  el.style.fontSize = ''; el.style.fontFamily = '';
  el.style.textAlign = ''; el.style.color = '';
  // Notify iframe to sync _editingOrigHtml with the cleared state
  const iframeWin = getIframeWin() as any;
  if (typeof iframeWin?._pixelApplyStyle === "function") {
    // _pixelApplyStyle with current values will re-send PIXEL_TEXT_CHANGE
    // Use a no-op style change to trigger the sync
    iframeWin._pixelSaveEdit?.();
  }
}
```

Wait — `_pixelSaveEdit` calls `saveCurrentEdit()` which sets `contentEditable = 'false'` and clears `_editingEl`. That would END the editing session. We don't want that for clearFormatting.

Instead, add a lighter function `_pixelSyncEdit`:

```javascript
// Sync _editingOrigHtml with current element state WITHOUT ending the editing session.
window._pixelSyncEdit = function() {
  if (!_editingEl) return;
  var newHtml = cleanHtml(_editingEl);
  if (newHtml !== _editingOrigHtml) {
    window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:_editingOrigHtml, newHtml:newHtml, needsRebuild:false }, '*');
    _editingOrigHtml = newHtml;
  }
};
```

Add this alongside the other `window._pixel*` functions.

Then update `clearFormatting` in PixelToolbar to call it at the end:

```typescript
// After clearing all styles, sync the change to localPages
const iframeWin = getIframeWin() as any;
if (typeof iframeWin?._pixelSyncEdit === "function") iframeWin._pixelSyncEdit();
```

---

## Fix 6: Sync after execCommand (bold/italic/underline/strikethrough/color)

For `execCmd` calls (bold, italic, underline, strikethrough) and `applyColor`, also call `_pixelSyncEdit` after the command so `localPages` is immediately updated:

```typescript
function execCmd(cmd: string, value?: string) {
  if (!restoreIframeFocus()) return;
  const doc = getIframeDoc();
  if (!doc) return;
  doc.execCommand('styleWithCSS', false, 'true');
  doc.execCommand(cmd, false, value ?? '');
  // Sync change to localPages immediately
  const iframeWin = getIframeWin() as any;
  if (typeof iframeWin?._pixelSyncEdit === "function") iframeWin._pixelSyncEdit();
}
```

And in `applyColor` after the execCommand:
```typescript
// After doc.execCommand('foreColor', ...)
const iframeWin = getIframeWin() as any;
if (typeof iframeWin?._pixelSyncEdit === "function") iframeWin._pixelSyncEdit();
```

---

## Summary of all new injection script functions

Add these three to the injection script in `page.tsx`, near the existing `window._pixelApplyFontFamily`:

```javascript
window._pixelApplyStyle = function(prop, value) {
  if (!_editingEl) return;
  _editingEl.style[prop] = value;
  var newHtml = cleanHtml(_editingEl);
  if (newHtml !== _editingOrigHtml) {
    window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:_editingOrigHtml, newHtml:newHtml, needsRebuild:false }, '*');
    _editingOrigHtml = newHtml;
  }
};

window._pixelSyncEdit = function() {
  if (!_editingEl) return;
  var newHtml = cleanHtml(_editingEl);
  if (newHtml !== _editingOrigHtml) {
    window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:_editingOrigHtml, newHtml:newHtml, needsRebuild:false }, '*');
    _editingOrigHtml = newHtml;
  }
};

window._pixelSaveEdit = function() {
  if (_editingEl) saveCurrentEdit();
};
```

---

## Verification Commands

```bash
cd ~/Projects/zing-pixel-dashboard

# 1. Build passes
npm run build && echo "BUILD OK"

# 2. _pixelApplyStyle in injection script
grep -q "_pixelApplyStyle" "app/dashboard/sites/[siteId]/page.tsx" && echo "_pixelApplyStyle OK"

# 3. _pixelSyncEdit in injection script
grep -q "_pixelSyncEdit" "app/dashboard/sites/[siteId]/page.tsx" && echo "_pixelSyncEdit OK"

# 4. _pixelSaveEdit in injection script
grep -q "_pixelSaveEdit" "app/dashboard/sites/[siteId]/page.tsx" && echo "_pixelSaveEdit OK"

# 5. applyFontSize uses _pixelApplyStyle (not el.style directly)
grep -q "_pixelApplyStyle" "components/PixelToolbar.tsx" && echo "PixelToolbar uses _pixelApplyStyle OK"

# 6. deployLocalHtml calls _pixelSaveEdit
grep -q "_pixelSaveEdit" "app/dashboard/sites/[siteId]/page.tsx" && echo "deploy flush OK"

# 7. execCmd calls _pixelSyncEdit
grep -q "_pixelSyncEdit" "components/PixelToolbar.tsx" && echo "execCmd sync OK"
```

## Commit and push

```bash
git add -A && git commit -m "fix: all style changes persist via PIXEL_TEXT_CHANGE, flush edit before deploy

- _pixelApplyStyle: fontSize + textAlign now go through PIXEL_TEXT_CHANGE (no more revert)
- _pixelSyncEdit: bold/italic/color/clearFormat immediately update localPages
- _pixelSaveEdit: deployLocalHtml + deployAllPages flush active edit before committing
- All three exposed on iframe window, called from PixelToolbar and page.tsx" && git push
```

## Completion signal

Output: <promise>PERSIST_FIXED</promise>
