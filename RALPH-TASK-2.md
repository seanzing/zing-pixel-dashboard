# Ralph Loop Task 2 — Font Picker Fix + Toolbar Session Stability

## Current Problems

### Problem 1: Font picker still closes unexpectedly
The editing session ends and the font picker closes while the user is browsing fonts. Multiple timer-based approaches have failed. The root cause is that `focusout` in the iframe fires any time focus moves to the parent document, and the timer-cancel approach is fragile/unreliable.

### Problem 2: Font picker appears behind the toolbar and gets cut off
The FontPicker is rendered in the sidebar area of the page and has insufficient z-index. The PixelToolbar has `z-index: 2147483647`. The font picker appears behind it and is clipped.

---

## Solution 1: Remove focusout-based saving entirely

**The current approach (broken):** `focusout` → debounced save timer → complicated cancel logic.

**The correct approach:** Remove the `focusout`-based save timer completely. Instead, only save when the user explicitly clicks outside text/image elements WITHIN THE IFRAME.

### Change the injection script in `app/dashboard/sites/[siteId]/page.tsx`:

**DELETE the entire focusout handler:**
```javascript
// DELETE THIS — remove entirely:
document.addEventListener('focusout', function(e) {
  if (!_editingEl || e.target !== _editingEl) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(...);
});

// DELETE THIS — remove entirely:
document.addEventListener('focusin', function(e) {
  if (e.target === _editingEl) { clearTimeout(_saveTimer); _saveTimer = null; }
});
```

**Also DELETE these variables (no longer needed):**
```javascript
var _savedRange = null;  // DELETE
var _saveTimer = null;   // DELETE
```

**And DELETE `window._pixelCancelSave`** — no longer needed.

**REPLACE with a click-outside handler that saves when clicking in the iframe outside text elements:**

Find the existing dismiss handler in `init()`:
```javascript
// Dismiss on blank area click
document.addEventListener('click', function(e) {
  if (!_imgSelected) return;
  if (!e.target.closest('[data-pixel-el]') && !e.target.closest('[data-pixel-text]')) {
    clearImgSelection();
    window.parent.postMessage({ type:'PIXEL_DESELECT' }, '*');
  }
});
```

Replace it with this combined handler:
```javascript
document.addEventListener('click', function(e) {
  var onText = e.target.closest('[data-pixel-text]');
  var onImg = e.target.closest('[data-pixel-el]');
  // Save text editing session if click landed outside all text elements
  if (_editingEl && !onText) {
    saveCurrentEdit();
  }
  // Deselect image if click landed outside all image/text elements
  if (_imgSelected && !onImg && !onText) {
    clearImgSelection();
    window.parent.postMessage({ type: 'PIXEL_DESELECT' }, '*');
  }
});
```

**Why this works:** When the user is editing text and clicks the toolbar/font picker (in the parent document), NO click event fires in the iframe. So `saveCurrentEdit()` is never called. The session stays alive indefinitely. When the user clicks back into the iframe on a non-text area, the session ends normally.

**Also update `saveCurrentEdit()` to not reference `_saveTimer`:**
```javascript
function saveCurrentEdit() {
  if (!_editingEl) return;
  var el = _editingEl, orig = _editingOrigHtml;
  el.contentEditable = 'false';
  var newHtml = cleanHtml(el);
  if (newHtml !== orig) {
    window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:orig, newHtml:newHtml, needsRebuild:false }, '*');
    _editingOrigHtml = newHtml;
  }
  window.parent.postMessage({ type:'PIXEL_SELECTION_STATE', isEditing:false }, '*');
  window.parent.postMessage({ type:'PIXEL_TEXT_END' }, '*');
  _editingEl = null; _editingOrigHtml = '';
}
```

**Also update `selectionchange` listener** — remove the `_savedRange` save since that variable is gone:
```javascript
document.addEventListener('selectionchange', function() {
  if (!_editingEl) return;
  sendSelectionState();
});
```

**Also remove `restoreForCommand()`** — no longer needed (only `_savedRange` restoration, which is gone).

**Also update the message handler** — `PIXEL_CONVERT_TAG` and `PIXEL_CONVERT_LIST` no longer need to call `clearTimeout`/cancel:
```javascript
window.addEventListener('message', function(e) {
  var d = e.data;
  if (!d || !d.type) return;
  if (d.type === 'PIXEL_CONVERT_TAG') {
    if (_editingEl) convertTag(d.tag);
  } else if (d.type === 'PIXEL_CONVERT_LIST') {
    if (_editingEl) convertToList(d.listTag);
  }
});
```

---

## Solution 2: Move FontPicker into PixelToolbar + fix positioning

**The current problem:** FontPicker is rendered in the page sidebar JSX, behind the toolbar z-index.

**The fix:** Move the FontPicker render INSIDE `PixelToolbar.tsx`, position it `fixed` relative to the Aa button, with `z-index: 2147483647 - 1` so it appears above everything except the toolbar itself (or equal z-index, just ensure it's positioned correctly).

### Changes to `components/PixelToolbar.tsx`:

1. Import FontPicker:
```typescript
import FontPicker from "@/components/FontPicker";
```

2. Add state for showing the font picker:
```typescript
const [showFontPicker, setShowFontPicker] = useState(false);
const [currentFont, setCurrentFont] = useState<string | undefined>();
const aaButtonRef = useRef<HTMLButtonElement>(null);
```

3. The `onFontPickerOpen` prop is no longer needed (handle internally). Remove it from the interface and component signature.

4. Add an `onFontSelect` prop to pass the selected font back to the parent (for `applyFont` in page.tsx):
```typescript
interface PixelToolbarProps {
  state: SelectionState | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  iframeRect: DOMRect | null;
  onFontSelect: (family: string, linkHref: string) => void;  // <-- replace onFontPickerOpen
}
```

5. Internal font apply handler:
```typescript
function handleFontSelect(family: string, linkHref: string) {
  setCurrentFont(family);
  setShowFontPicker(false);
  // Apply directly to iframe (style-only, no focus needed)
  const el = getEditingEl();
  const doc = getIframeDoc();
  if (el && doc) {
    el.style.fontFamily = family;
    if (linkHref) {
      let link = doc.querySelector('link[data-pixel-font]') as HTMLLinkElement;
      if (link) { link.href = linkHref; }
      else {
        link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.setAttribute('data-pixel-font', '1');
        link.href = linkHref;
        doc.head.appendChild(link);
      }
    }
  }
  // Notify parent so it can persist the font link in localHtml
  onFontSelect(family, linkHref);
}
```

6. Aa button with ref for position tracking:
```tsx
<button
  ref={aaButtonRef}
  className={btnClass(false)}
  title="Font family"
  onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
  onClick={() => setShowFontPicker(p => !p)}
>
  Aa
</button>
```

7. FontPicker rendered with `position: fixed`, positioned BELOW the toolbar:
```tsx
{showFontPicker && (
  <div
    style={{
      position: 'fixed',
      top: clampedTop + TOOLBAR_HEIGHT + 8,  // below the toolbar
      left: Math.min(clampedLeft + 400, window.innerWidth - 320),  // near Aa button, right-anchored
      zIndex: 2147483647,
      width: 300,
      maxHeight: 400,
      overflowY: 'auto',
      background: 'white',
      borderRadius: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
    }}
  >
    <FontPicker
      currentFont={currentFont}
      onSelect={handleFontSelect}
      onClose={() => setShowFontPicker(false)}
    />
  </div>
)}
```

### Changes to `app/dashboard/sites/[siteId]/page.tsx`:

1. Remove the separate `showFontPicker` state from the page (it's now managed in PixelToolbar).

2. Update the PixelToolbar JSX:
```tsx
<PixelToolbar
  state={toolbarState}
  iframeRef={iframeRef}
  iframeRect={iframeRect}
  onFontSelect={(family, linkHref) => {
    // Persist font link in localHtml
    setCurrentFont(family);
    if (linkHref) {
      setLocalPages(prev => {
        const current = prev[currentPage];
        if (!current) return prev;
        if (current.includes(linkHref)) return prev;
        const stripped = current.replace(/<link[^>]+data-pixel-font[^>]+>/g, '');
        const tag = `<link rel="stylesheet" href="${linkHref}" data-pixel-font="true">`;
        const updated = stripped.includes('</head>')
          ? stripped.replace('</head>', `${tag}\n</head>`)
          : tag + stripped;
        return { ...prev, [currentPage]: updated };
      });
    }
  }}
/>
```

3. Remove `onFontPickerOpen` from the PixelToolbar usage.

4. The existing separate FontPicker rendered in the sidebar (near the "Aa" button at line ~2020) can remain — that's for the whole-page font selection, separate from the text element editing. Make sure it still uses `applyFont` for the page-level font (do not break this).

5. Remove `cancelIframeSave()` calls everywhere — no longer needed (no timer to cancel).

---

## Also clean up PixelToolbar

Remove the `cancelIframeSave()` function and all calls to it — they're no longer needed.

---

## Verification Commands

```bash
cd ~/Projects/zing-pixel-dashboard

# 1. Build must pass
npm run build && echo "BUILD OK"

# 2. No focusout timer in injection script
grep -q "_saveTimer" "app/dashboard/sites/[siteId]/page.tsx" && echo "FAIL: saveTimer still present" || echo "saveTimer REMOVED OK"

# 3. FontPicker imported in PixelToolbar
grep -q "FontPicker" "components/PixelToolbar.tsx" && echo "FontPicker in toolbar OK"

# 4. FontPicker positioned fixed in PixelToolbar
grep -q "position.*fixed" "components/PixelToolbar.tsx" | grep -q "FontPicker" && echo "FontPicker fixed OK" || \
  grep -q "zIndex.*2147483647" "components/PixelToolbar.tsx" && echo "zIndex OK"

# 5. cancelIframeSave removed from PixelToolbar
grep -q "cancelIframeSave" "components/PixelToolbar.tsx" && echo "FAIL: cancelIframeSave still present" || echo "cancelIframeSave REMOVED OK"

# 6. click-outside handler present in injection script
grep -q "PIXEL_DESELECT" "app/dashboard/sites/[siteId]/page.tsx" && echo "click handler OK"
```

## Push and complete
When all checks pass, run:
```bash
cd ~/Projects/zing-pixel-dashboard && git add -A && git commit -m "fix: remove timer-based save, move FontPicker into PixelToolbar with fixed positioning" && git push
```

Then output: <promise>FONT_PICKER_FIXED</promise>
