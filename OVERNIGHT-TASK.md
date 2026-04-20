# Overnight Task — Pixel Dashboard Toolbar Rewrite

## The Problem

The inline text editor toolbar does not work reliably. Specifically:
- Clicking any toolbar button **unselects** the highlighted text in the editor
- **Color picker** never applies color to selected text
- Toolbar repositions when user makes a selection

All fixes so far have failed because they try to work around a fundamental browser constraint:
**clicking any element in the same document as a `contenteditable` can steal focus and clear the selection**, regardless of `e.preventDefault()`.

## Root Cause

The toolbar is injected into the **iframe blob document** (same document as the editing element). Clicking a button in the same document can disrupt the contenteditable selection. Professional WYSIWYG editors (TinyMCE, Froala, CKEditor) all avoid this by putting the toolbar in the **parent document**.

## Required Fix: Move Toolbar to Parent Document

When the toolbar lives in the **parent Next.js page** (not inside the iframe), clicking toolbar buttons **never affects the iframe's selection**. The iframe maintains a completely independent selection context. This is the correct architecture.

## Architecture Overview

### Current (broken):
```
Parent page.tsx
  └── <iframe src={blobUrl}>
        └── Site HTML
        └── [data-pixel-text] elements  
        └── #pixel-toolbar (THE PROBLEM)
```

### Target (correct):
```
Parent page.tsx
  └── <PixelToolbar> (floating React component in PARENT)
  └── <iframe src={blobUrl}>
        └── Site HTML
        └── [data-pixel-text] elements (still editable)
        └── NO toolbar here — just postMessage communication
```

## Communication Protocol (postMessage)

### Iframe → Parent messages (already partially exists):
- `PIXEL_TEXT_START` — user activated editing on an element
- `PIXEL_TEXT_END` — editing session ended  
- `PIXEL_TEXT_CHANGE` — text content changed
- **NEW:** `PIXEL_SELECTION_STATE` — fires on `selectionchange`; carries toolbar state + element position

### Parent → Iframe messages (NEW):
- `PIXEL_CMD` — execute a formatting command: `{ cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'foreColor', value?: string }`
- `PIXEL_SET_ALIGN` — `{ align: 'left' | 'center' | 'right' }`
- `PIXEL_SET_FONTSIZE` — `{ size: number }`
- `PIXEL_SET_FONTFAMILY` — `{ family: string }` (already exists as `PIXEL_APPLY_FONT`)
- `PIXEL_CLEAR_FORMAT` — strip all formatting
- `PIXEL_CONVERT_TAG` — `{ tag: 'h1' | 'h2' | 'h3' | 'h4' | 'p' }`
- `PIXEL_CONVERT_LIST` — `{ listTag: 'ul' | 'ol' }`

### `PIXEL_SELECTION_STATE` payload:
```json
{
  "type": "PIXEL_SELECTION_STATE",
  "isEditing": true,
  "bold": false,
  "italic": false,
  "underline": false,
  "strikethrough": false,
  "align": "left",
  "fontSize": 16,
  "color": "#000000",
  "hasSelection": true,
  "elementTag": "p",
  "elementRect": { "top": 340, "left": 120, "bottom": 380, "right": 800 }
}
```

## Changes Required

### 1. `app/dashboard/sites/[siteId]/page.tsx` — major changes

**A. Remove from the injection script (`interactionScript` template literal):**
- All CSS for `#pixel-toolbar` and color panel
- `initToolbar()` function entirely
- `updateToolbarState()` function (replace with `sendSelectionState()`)
- All toolbar-related button handlers
- `positionToolbar()` function
- `_savedRange` variable (no longer needed)

**B. Add to the injection script:**
```javascript
// Send selection state to parent on every selectionchange
document.addEventListener('selectionchange', function() {
  if (!_editingEl) return;
  sendSelectionState();
});

function sendSelectionState() {
  if (!_editingEl) return;
  var sel = window.getSelection();
  var hasSelection = sel && sel.rangeCount > 0 && !sel.isCollapsed;
  var rect = _editingEl.getBoundingClientRect();
  window.parent.postMessage({
    type: 'PIXEL_SELECTION_STATE',
    isEditing: true,
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    underline: document.queryCommandState('underline'),
    strikethrough: document.queryCommandState('strikeThrough'),
    align: (function() {
      var a = _editingEl.style.textAlign || window.getComputedStyle(_editingEl).textAlign || 'left';
      return a === 'start' ? 'left' : a === 'end' ? 'right' : a;
    })(),
    fontSize: parseInt(_editingEl.style.fontSize || window.getComputedStyle(_editingEl).fontSize) || 16,
    color: (function() {
      var c = window.getComputedStyle(_editingEl).color;
      var m = c && c.match(/\d+/g);
      if (m && m.length >= 3) return '#' + [m[0],m[1],m[2]].map(function(n){return ('0'+parseInt(n).toString(16)).slice(-2);}).join('');
      return '#000000';
    })(),
    hasSelection: !!hasSelection,
    elementTag: _editingEl.tagName.toLowerCase(),
    elementRect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }
  }, '*');
}
```

**C. Add message receiver to injection script (handle parent → iframe commands):**
```javascript
window.addEventListener('message', function(e) {
  if (!_editingEl) return;
  var d = e.data;
  if (!d || !d.type) return;
  if (d.type === 'PIXEL_CMD') {
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(d.cmd, false, d.value || null);
    sendSelectionState();
  } else if (d.type === 'PIXEL_SET_ALIGN') {
    _editingEl.style.textAlign = d.align;
    sendSelectionState();
  } else if (d.type === 'PIXEL_SET_FONTSIZE') {
    _editingEl.style.fontSize = d.size + 'px';
    sendSelectionState();
  } else if (d.type === 'PIXEL_SET_FONTFAMILY') {
    _editingEl.style.fontFamily = d.family;
    // inject google fonts link
    var existingLink = document.querySelector('link[data-pixel-font]');
    if (existingLink) existingLink.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(d.family) + ':wght@300;400;500;600;700&display=swap';
    else {
      var link = document.createElement('link');
      link.rel = 'stylesheet'; link.setAttribute('data-pixel-font', '1');
      link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(d.family) + ':wght@300;400;500;600;700&display=swap';
      document.head.appendChild(link);
    }
    sendSelectionState();
  } else if (d.type === 'PIXEL_CLEAR_FORMAT') {
    document.execCommand('removeFormat');
    // strip color spans
    _editingEl.querySelectorAll('span[style*="color"],font[color]').forEach(function(n) {
      var p = n.parentNode; if (!p) return;
      while (n.firstChild) p.insertBefore(n.firstChild, n);
      p.removeChild(n);
    });
    try { _editingEl.normalize(); } catch(e2) {}
    _editingEl.style.fontSize = ''; _editingEl.style.fontFamily = '';
    _editingEl.style.textAlign = ''; _editingEl.style.color = '';
    sendSelectionState();
  } else if (d.type === 'PIXEL_CONVERT_TAG') {
    convertTag(d.tag);
  } else if (d.type === 'PIXEL_CONVERT_LIST') {
    convertToList(d.listTag);
  }
});
```

**D. Keep `activateEdit` but remove `positionToolbar` and `updateToolbarState` calls:**
```javascript
function activateEdit(el, origHtml, cx, cy) {
  if (_editingEl && _editingEl !== el) saveCurrentEdit();
  _editingEl = el; _editingOrigHtml = origHtml;
  el.contentEditable = 'true'; el.focus({ preventScroll: true });
  try {
    var r = document.caretRangeFromPoint(cx, cy);
    if (r) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
  } catch(err) {}
  sendSelectionState();
  window.parent.postMessage({ type:'PIXEL_TEXT_START' }, '*');
}
```

**E. `saveCurrentEdit` sends `PIXEL_SELECTION_STATE` with `isEditing: false` when done:**
After saving, send: `window.parent.postMessage({ type: 'PIXEL_SELECTION_STATE', isEditing: false }, '*');`

**F. The `focusout` handler can be simplified** — no toolbar `relatedTarget` checks needed since toolbar is in parent.

### 2. Create `components/PixelToolbar.tsx`

A floating React component:
- Receives `toolbarState` prop (the PIXEL_SELECTION_STATE payload)
- Receives `iframeRef` prop (to send postMessage commands)
- Renders the toolbar only when `toolbarState.isEditing === true`
- Positions itself above the `elementRect` using `position: fixed` in the parent viewport
- Converts `elementRect` from iframe coordinates to parent coordinates (add iframe's `getBoundingClientRect()` offset)

**Props:**
```typescript
interface PixelToolbarProps {
  state: SelectionState | null;  // null when not editing
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  iframeRect: DOMRect | null;    // iframe's position in the parent viewport
  onFontPickerOpen: () => void;
  onFontSelect: (family: string) => void;
}
```

**Positioning:**
```typescript
// Convert iframe-relative elementRect to parent-viewport position
const top = iframeRect.top + state.elementRect.top - toolbarHeight - 10;
const left = iframeRect.left + state.elementRect.left;
// Clamp to viewport
```

**Sending commands:**
```typescript
function sendCmd(cmd: string, value?: string) {
  iframeRef.current?.contentWindow?.postMessage({ type: 'PIXEL_CMD', cmd, value }, '*');
}
```

**Toolbar sections (same as current):**
- B / I / U / S (bold/italic/underline/strikethrough)
- Color button + panel (32 swatches + hex input)
- Alignment (left/center/right)
- Clear formatting
- Bullet / Numbered list
- H1 H2 H3 H4 P tag conversion
- px font size input
- Aa font picker button

**Color panel:** Standard React state, no focus issues since it's in the parent.

### 3. Update `page.tsx` parent-side message handler

Replace the current `PIXEL_OPEN_FONT_PICKER` / `PIXEL_APPLY_FONT` handlers and add handler for `PIXEL_SELECTION_STATE`:

```typescript
case 'PIXEL_SELECTION_STATE':
  setToolbarState(data.isEditing ? data : null);
  // Update iframeRect when editing starts
  if (data.isEditing && iframeRef.current) {
    setIframeRect(iframeRef.current.getBoundingClientRect());
  }
  break;
```

Add new state:
```typescript
const [toolbarState, setToolbarState] = useState<SelectionState | null>(null);
const [iframeRect, setIframeRect] = useState<DOMRect | null>(null);
```

### 4. Render `<PixelToolbar>` in `page.tsx`

Place it near the top of the JSX return, outside the iframe container (so it renders in the parent stacking context):

```tsx
{rightTab === 'preview' && (
  <PixelToolbar
    state={toolbarState}
    iframeRef={iframeRef}
    iframeRect={iframeRect}
    onFontPickerOpen={() => setShowFontPicker(true)}
    onFontSelect={(family) => {
      iframeRef.current?.contentWindow?.postMessage({ type: 'PIXEL_SET_FONTFAMILY', family }, '*');
    }}
  />
)}
```

## Files to Modify
- `app/dashboard/sites/[siteId]/page.tsx` — injection script + parent postMessage handler + state + render
- `components/PixelToolbar.tsx` — NEW file (create from scratch)

## Files to Leave Alone
- `components/FontPicker.tsx` — reuse as-is, just wire to `onFontSelect`
- All API routes (`/api/sites/[siteId]/...`)
- All non-editor functionality

## Success Criteria
1. `npm run build` passes with no TypeScript errors
2. Git commit pushed to `seanzing/zing-pixel-dashboard` on `main`
3. Toolbar renders in parent page (visible above the iframe element)
4. Clicking Bold with text selected → text becomes bold (verify by inspecting DOM or visual)
5. Clicking color swatch with text selected → text gets colored
6. Toolbar does NOT reposition when user changes selection
7. Toolbar hides when clicking outside the editing element
8. Existing functionality preserved: image replace, AI chat, deploy, undo/redo, font picker

## Important Notes
- The repo is at `~/Projects/zing-pixel-dashboard/`
- GitHub remote: `https://github.com/seanzing/zing-pixel-dashboard.git`
- GitHub token: `GH_TOKEN_IN_ENV`
- Railway deploys automatically on push to `main`
- Run `npm run build` before committing — must pass
- The interaction script is a JavaScript string (template literal) embedded in TypeScript. Be careful with backtick escaping.
- `iframeRef` already exists in the component — find it with `grep -n "iframeRef" page.tsx`
- The existing `PIXEL_APPLY_FONT` message from iframe → parent can be removed; replace with `PIXEL_SET_FONTFAMILY` going parent → iframe
- Keep `PIXEL_IMG_CLICK`, `PIXEL_DESELECT`, `PIXEL_TEXT_START`, `PIXEL_TEXT_END`, `PIXEL_TEXT_CHANGE` — these all still work

## Context on Current State
The current code has a working injection script with all the right CSS styles for `[data-pixel-text]` hover/focus states, image selection, click-to-activate editing. All of that stays. Only the toolbar needs to move.

The `convertTag` and `convertToList` functions should STAY in the injection script (they manipulate the iframe DOM). They just get triggered by incoming postMessages instead of button clicks.

After `convertTag`, send `sendSelectionState()` instead of calling `positionToolbar` / `updateToolbarState`.
