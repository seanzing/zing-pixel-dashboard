# Ralph Loop Task — Pixel Dashboard WYSIWYG Toolbar

## Problem
The text editor toolbar in the Pixel Dashboard does not work. Selecting text and clicking toolbar buttons has no effect. Multiple patch attempts have failed.

## Root Cause (Definitive)
The blob iframe and the parent React page are **two separate browsing contexts**. When the user clicks a toolbar button in the parent, the iframe loses focus. All previous approaches tried to work around this with postMessage timing hacks. They all fail.

## Correct Solution
Since the iframe is **same-origin** (blob URL from the same page), the parent has DIRECT DOM access to the iframe. The toolbar should:

1. On `mousedown`: save the iframe's selection BEFORE focus moves away  
2. On `click`: refocus the iframe's editing element directly, restore the saved selection, then call `iframeDoc.execCommand()` directly on the **iframe's document** — no postMessage needed for formatting commands

This is how professional editors (like the original TinyMCE iframe mode) work.

## Files to Modify
- `components/PixelToolbar.tsx` — completely rewrite command handling
- `app/dashboard/sites/[siteId]/page.tsx` — fix injection script focusout handling

## Implementation

### PixelToolbar.tsx — Rewrite command dispatch

Add these refs inside the component:
```typescript
const savedRangeRef = useRef<Range | null>(null);

function getIframeDoc() {
  return iframeRef.current?.contentDocument ?? null;
}
function getIframeWin() {
  return iframeRef.current?.contentWindow ?? null;
}
function getEditingEl(): HTMLElement | null {
  return (getIframeDoc()?.querySelector('[contenteditable="true"]') as HTMLElement) ?? null;
}

// Called on mousedown of any toolbar button — saves selection BEFORE focus moves
function saveIframeSelection() {
  const sel = getIframeWin()?.getSelection();
  if (sel && sel.rangeCount > 0) {
    try { savedRangeRef.current = sel.getRangeAt(0).cloneRange(); } catch(e) {}
  }
}

// Called before every command — refocuses iframe editing element and restores selection
function restoreIframeFocus() {
  const el = getEditingEl();
  const iframeWin = getIframeWin();
  if (!el || !iframeWin) return false;
  el.focus({ preventScroll: true });
  if (savedRangeRef.current) {
    try {
      const sel = iframeWin.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current); }
    } catch(e) {}
  }
  return true;
}

// Execute a formatting command directly on the iframe document
function execCmd(cmd: string, value?: string) {
  if (!restoreIframeFocus()) return;
  const doc = getIframeDoc();
  if (!doc) return;
  doc.execCommand('styleWithCSS', false, 'true');
  doc.execCommand(cmd, false, value ?? null);
}
```

**All toolbar button handlers must call `saveIframeSelection` on mousedown and `execCmd` on click.** Example for Bold button:
```tsx
<button
  onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
  onClick={() => execCmd('bold')}
  className={state.bold ? "px-active" : ""}
>B</button>
```

**The `e.preventDefault()` on mousedown is still needed** to prevent the button from receiving keyboard focus (which would shift focus away from the iframe context entirely).

**Color picker:** 
```typescript
function applyColor(color: string) {
  if (!restoreIframeFocus()) return;
  const doc = getIframeDoc();
  if (!doc) return;
  const sel = getIframeWin()?.getSelection();
  if (sel && !sel.isCollapsed) {
    doc.execCommand('styleWithCSS', false, 'true');
    doc.execCommand('foreColor', false, color);
  } else {
    // No selection — apply to whole element
    const el = getEditingEl();
    if (el) el.style.color = color;
  }
}
```

**Alignment:**
```typescript
function applyAlign(align: string) {
  if (!restoreIframeFocus()) return;
  const el = getEditingEl();
  if (el) el.style.textAlign = align;
}
```

**Font size:**
```typescript
function applyFontSize(size: number) {
  if (!restoreIframeFocus()) return;
  const el = getEditingEl();
  if (el) el.style.fontSize = size + 'px';
}
```

**Clear formatting:**
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
  try { el.normalize(); } catch(e) {}
  el.style.fontSize = ''; el.style.fontFamily = '';
  el.style.textAlign = ''; el.style.color = '';
}
```

**Tag conversion and list conversion:** These still need postMessage because they restructure the iframe DOM (replace elements). Keep the existing `PIXEL_CONVERT_TAG` and `PIXEL_CONVERT_LIST` postMessage handlers for those two only.

**Font family (Google Fonts):**
```typescript
function applyFontFamily(family: string) {
  if (!restoreIframeFocus()) return;
  const el = getEditingEl();
  const doc = getIframeDoc();
  if (!el || !doc) return;
  el.style.fontFamily = family;
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@300;400;500;600;700&display=swap`;
  let link = doc.querySelector('link[data-pixel-font]') as HTMLLinkElement;
  if (link) { link.href = href; }
  else {
    link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-pixel-font', '1');
    link.href = href;
    doc.head.appendChild(link);
  }
}
```

### Inject script in page.tsx — fix focusout

The `focusout` handler must debounce saving so that when the parent re-focuses the editing element (after a toolbar click), the save is cancelled:

```javascript
var _saveTimer = null;

document.addEventListener('focusout', function(e) {
  if (!_editingEl || e.target !== _editingEl) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(function() {
    _saveTimer = null;
    if (_editingEl) saveCurrentEdit();
  }, 400);
});

// When the editing element regains focus (parent called editingEl.focus()),
// cancel the pending save
document.addEventListener('focusin', function(e) {
  if (e.target === _editingEl) {
    clearTimeout(_saveTimer);
    _saveTimer = null;
  }
});
```

Also add `clearTimeout(_saveTimer); _saveTimer = null;` at the top of `saveCurrentEdit()`.

The PIXEL_CMD / PIXEL_SET_ALIGN / PIXEL_SET_FONTSIZE / PIXEL_CLEAR_FORMAT message handlers in the injection script can be REMOVED (commands are now handled directly by parent DOM access). Only keep:
- `PIXEL_CONVERT_TAG` — still needed (complex DOM restructure)
- `PIXEL_CONVERT_LIST` — still needed (complex DOM restructure)

### PixelToolbar.tsx — Positioning

The toolbar uses `position: fixed` in the parent document. The `iframeRect` is the iframe's bounding rect in the parent viewport. The element's `elementRect` is relative to the iframe's viewport. So:

```typescript
const toolbarTop = iframeRect.top + state.elementRect.top - TOOLBAR_HEIGHT - 10;
const clampedTop = toolbarTop < 8 ? iframeRect.top + state.elementRect.bottom + 10 : toolbarTop;
const clampedLeft = Math.max(8, Math.min(iframeRect.left + state.elementRect.left, window.innerWidth - 620));
```

### Color panel — click handling

The color panel swatches should use `onMouseDown` for saving selection and `onClick` for applying:

```tsx
<div
  onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
  onClick={() => applyColor(color)}
  style={{ background: color }}
  className="px-swatch"
/>
```

## Complete PixelToolbar structure

The component receives:
- `state: SelectionState | null` — toolbar state from iframe (bold, italic, color, align, fontSize, etc.)
- `iframeRef: React.RefObject<HTMLIFrameElement | null>`
- `iframeRect: DOMRect | null`
- `onFontPickerOpen: () => void`

It renders:
- Bold, Italic, Underline, Strikethrough buttons — `execCmd('bold')` etc.
- Color button + 32-swatch panel + hex input
- Align left/center/right
- Clear formatting
- Bullet list / Numbered list (via `PIXEL_CONVERT_LIST` postMessage)
- H1/H2/H3/H4/P (via `PIXEL_CONVERT_TAG` postMessage)
- Font size input
- Aa (font family, opens FontPicker)

ALL buttons use `onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}`.

## Success Criteria — All must pass

1. **`npm run build` passes with zero TypeScript errors**
2. **`components/PixelToolbar.tsx` contains `savedRangeRef`** (grep check)
3. **`components/PixelToolbar.tsx` contains `contentDocument.execCommand`** OR `iframeDoc.execCommand` (grep check — direct iframe access, NOT postMessage)
4. **`components/PixelToolbar.tsx` contains `contentWindow.getSelection`** (grep check — saves selection from iframe)
5. **`components/PixelToolbar.tsx` contains `contenteditable`** in a `querySelector` call (grep check — finds editing element in iframe)
6. **`page.tsx` injection script contains `focusin` listener** that cancels `_saveTimer` (grep check)
7. **`page.tsx` injection script does NOT contain `PIXEL_CMD`** in the message handler OR it only routes to convertTag/convertList (grep check — no general command routing needed anymore)

## Verification Commands
```bash
cd ~/Projects/zing-pixel-dashboard

# 1. Build must pass
npm run build && echo "BUILD OK"

# 2. savedRangeRef present
grep -q "savedRangeRef" components/PixelToolbar.tsx && echo "savedRangeRef OK"

# 3. Direct execCommand on iframe doc
grep -q "contentDocument" components/PixelToolbar.tsx && echo "iframeDoc access OK"

# 4. Saves iframe selection
grep -q "contentWindow" components/PixelToolbar.tsx && echo "iframeWin access OK"

# 5. Finds contenteditable element
grep -q "contenteditable" components/PixelToolbar.tsx && echo "querySelector OK"

# 6. focusin cancels save
grep -n "focusin" "app/dashboard/sites/[siteId]/page.tsx" | grep -q "_saveTimer" && echo "focusin cancel OK"
```

## Important Context
- Repo: `~/Projects/zing-pixel-dashboard/`
- GitHub: `https://github.com/seanzing/zing-pixel-dashboard.git`  
- Push to `main` when done (Railway auto-deploys)
- `npm run build` must pass before committing
- The injection script is a JavaScript template literal inside TypeScript — watch for backtick escaping issues
- The iframe blob is same-origin — direct `contentDocument` and `contentWindow` access works
- `iframeRef` already exists in the parent component (find with `grep -n "iframeRef" app/dashboard/sites/[siteId]/page.tsx`)
- `FontPicker.tsx` component already exists — wire it through `onFontPickerOpen` prop

## When Done
Run: `openclaw system event --text "Ralph complete: Pixel toolbar rewrite done, pushed to main" --mode now`

Output: <promise>TOOLBAR_WORKING</promise>
