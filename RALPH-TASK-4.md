# Ralph Loop Task 4 — Pixel Editor: Link Editing + Section Visibility Toggle

## Overview

Two new features for the Pixel Dashboard WYSIWYG editor:

1. **Link / CTA URL editing** — click any `<a>` tag in the preview to open a small popover with its current URL; edit and save; changes go through PIXEL_TEXT_CHANGE so they persist and are deployable.

2. **Section visibility toggle** — click any top-level section/div in the preview to get a "Hide section" / "Show section" button; hidden sections get `data-pixel-hidden="true"` and `display:none`; still visible in the editor as a collapsed grey placeholder showing "Hidden section — click to restore".

---

## Files to edit

- `app/dashboard/sites/[siteId]/page.tsx` — injection script, message handler, UI state, parent UI
- `components/PixelToolbar.tsx` — (NO changes needed for these features)

---

## Feature 1: Link / CTA URL Editing

### 1A — Injection script: detect anchor clicks

In `init()`, AFTER the text editable setup, add link detection. Links that wrap text elements should be detected on click and post a message to the parent:

```javascript
// ─── Link Click Detection ─────────────────────────────────────────────────
// Detect clicks on <a> tags (or elements inside <a> tags).
// Buttons/CTAs may themselves be <a> tags, or may be <span>/<div> inside <a>.
document.querySelectorAll('a[href]').forEach(function(anchor) {
  anchor.addEventListener('click', function(e) {
    // Only intercept if NOT in text editing mode — text edit click handler takes priority
    if (_editingEl) return;
    e.preventDefault(); e.stopPropagation();
    var rect = anchor.getBoundingClientRect();
    window.parent.postMessage({
      type: 'PIXEL_LINK_CLICK',
      href: anchor.getAttribute('href') || '',
      text: anchor.textContent.trim().slice(0, 60),
      rect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, width: rect.width }
    }, '*');
    // Store reference for _pixelSetLinkHref
    window._pendingLinkEl = anchor;
  });
});
```

### 1B — Injection script: expose `_pixelSetLinkHref`

Add alongside the other `window._pixel*` functions:

```javascript
// Called by parent when user saves a new URL for the currently-selected link.
window._pixelSetLinkHref = function(newHref) {
  var anchor = window._pendingLinkEl;
  if (!anchor) return;
  var origHtml = anchor.outerHTML;
  anchor.setAttribute('href', newHref);
  var newHtml = anchor.outerHTML;
  if (newHtml !== origHtml) {
    window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origHtml, newHtml:newHtml, needsRebuild:false }, '*');
  }
  window._pendingLinkEl = null;
};
```

### 1C — Parent state: link edit popover

Add these state variables in `page.tsx` near the other UI state:

```typescript
const [linkEdit, setLinkEdit] = useState<{ href: string; text: string; rect: { top: number; left: number; bottom: number; right: number; width: number } } | null>(null);
const [linkEditValue, setLinkEditValue] = useState("");
const linkEditRef = useRef<HTMLInputElement>(null);
```

### 1D — Parent message handler: handle PIXEL_LINK_CLICK

In the `window.addEventListener("message", handler)` block, add:

```typescript
} else if (e.data?.type === "PIXEL_LINK_CLICK") {
  setLinkEdit({ href: e.data.href, text: e.data.text, rect: e.data.rect });
  setLinkEditValue(e.data.href);
  setTimeout(() => linkEditRef.current?.select(), 50);
}
```

### 1E — Link save handler

```typescript
function saveLinkEdit() {
  if (!linkEdit) return;
  const iframeWin = iframeRef.current?.contentWindow as any;
  if (typeof iframeWin?._pixelSetLinkHref === "function") {
    iframeWin._pixelSetLinkHref(linkEditValue.trim());
  }
  setDirtyPages(d => new Set([...d, currentPage]));
  setLinkEdit(null);
}
```

### 1F — Link edit popover UI

Render this inside the right panel area (alongside the existing blob iframe), positioned absolutely over the iframe. It should appear at the link's position (using iframeRect + link rect to compute viewport position).

The popover should be a small floating card, `position: fixed`, z-index high, appearing just below the clicked link:

```tsx
{linkEdit && iframeRect && (
  <div
    style={{
      position: 'fixed',
      top: iframeRect.top + linkEdit.rect.bottom + 8,
      left: Math.min(
        iframeRect.left + linkEdit.rect.left,
        window.innerWidth - 340
      ),
      zIndex: 2147483646,
      background: 'white',
      borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      border: '1px solid #e5e7eb',
      padding: '12px 14px',
      width: 320,
    }}
  >
    <div className="text-[11px] text-gray-400 mb-1.5 font-medium truncate">
      🔗 {linkEdit.text || "Link"}
    </div>
    <input
      ref={linkEditRef}
      value={linkEditValue}
      onChange={e => setLinkEditValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); saveLinkEdit(); }
        if (e.key === "Escape") setLinkEdit(null);
      }}
      placeholder="https://..."
      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-zing-teal mb-2"
      autoFocus
    />
    <div className="flex gap-2 justify-end">
      <button
        onClick={() => setLinkEdit(null)}
        className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-100"
      >
        Cancel
      </button>
      <button
        onClick={saveLinkEdit}
        className="text-xs bg-zing-teal text-white px-3 py-1.5 rounded-lg hover:bg-teal-700"
      >
        Save Link
      </button>
    </div>
  </div>
)}
```

Also close the popover if the user clicks elsewhere: add `onClick={() => { if (linkEdit) setLinkEdit(null); }}` to the outermost click-outside handler, or add a `useEffect` that adds a `pointerdown` listener and closes if click is outside the popover.

Close popover when page changes: add `linkEdit` to the page-switch cleanup.

---

## Feature 2: Section Visibility Toggle

### 2A — Injection script: detect section hover/click

In `init()`, add section detection AFTER the link click detection. Target top-level sections: `section`, `div` elements that are direct children of `main`, `body`, or that have a class containing "section", "block", "hero", "about", "services", "contact", "footer", "header", "cta", "testimonial", "faq", "gallery".

```javascript
// ─── Section Toggle ───────────────────────────────────────────────────────
var _hoveredSection = null;
var SECTION_SELECTORS = [
  'body > section', 'body > div', 'main > section', 'main > div',
  '[class*="section"]', '[class*="block"]', '[class*="hero"]',
  '[class*="about"]', '[class*="services"]', '[class*="contact"]',
  '[class*="footer"]', '[class*="header"]', '[class*="cta"]',
  '[class*="testimonial"]', '[class*="faq"]', '[class*="gallery"]'
].join(',');

document.querySelectorAll(SECTION_SELECTORS).forEach(function(section) {
  // Skip tiny elements (nav items, inline spans, etc.)
  if (section.offsetHeight < 60) return;
  // Skip elements that are themselves text or image targets
  if (section.hasAttribute('data-pixel-text') || section.hasAttribute('data-pixel-el')) return;

  section.addEventListener('mouseenter', function(e) {
    if (_editingEl) return; // don't interfere with text editing
    _hoveredSection = section;
    var rect = section.getBoundingClientRect();
    var isHidden = section.dataset.pixelHidden === 'true';
    window.parent.postMessage({
      type: 'PIXEL_SECTION_HOVER',
      rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
      isHidden: isHidden,
      sectionClass: section.className.slice(0, 60)
    }, '*');
  });

  section.addEventListener('mouseleave', function(e) {
    if (_hoveredSection === section) _hoveredSection = null;
    window.parent.postMessage({ type: 'PIXEL_SECTION_HOVER', rect: null }, '*');
  });

  section.addEventListener('click', function(e) {
    // Only fire if click is NOT on a text/image/link element
    if (e.target.closest('[data-pixel-text],[data-pixel-el],a[href]')) return;
    if (_editingEl) return;
    var isHidden = section.dataset.pixelHidden === 'true';
    window.parent.postMessage({
      type: 'PIXEL_SECTION_CLICK',
      isHidden: isHidden,
      origHtml: section.outerHTML
    }, '*');
    window._pendingSectionEl = section;
  });
});
```

### 2B — Injection script: expose `_pixelToggleSection`

```javascript
// Called by parent to hide or show the pending section.
window._pixelToggleSection = function(hide) {
  var section = window._pendingSectionEl;
  if (!section) return;
  var origHtml = section.outerHTML;
  if (hide) {
    section.dataset.pixelHidden = 'true';
    section.style.display = 'none';
  } else {
    delete section.dataset.pixelHidden;
    section.style.display = '';
  }
  var newHtml = section.outerHTML;
  window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origHtml, newHtml:newHtml, needsRebuild:false }, '*');
  window._pendingSectionEl = null;
};
```

### 2C — Parent state for section overlay

```typescript
const [sectionHover, setSectionHover] = useState<{ rect: { top: number; left: number; width: number; height: number }; isHidden: boolean; sectionClass: string } | null>(null);
const [sectionAction, setSectionAction] = useState<{ isHidden: boolean } | null>(null);
```

### 2D — Parent message handler: PIXEL_SECTION_HOVER and PIXEL_SECTION_CLICK

```typescript
} else if (e.data?.type === "PIXEL_SECTION_HOVER") {
  if (e.data.rect) {
    setSectionHover({ rect: e.data.rect, isHidden: e.data.isHidden, sectionClass: e.data.sectionClass });
  } else {
    setSectionHover(null);
  }
} else if (e.data?.type === "PIXEL_SECTION_CLICK") {
  setSectionAction({ isHidden: e.data.isHidden });
}
```

### 2E — Section hide/show handlers

```typescript
function toggleSection(hide: boolean) {
  const iframeWin = iframeRef.current?.contentWindow as any;
  if (typeof iframeWin?._pixelToggleSection === "function") {
    iframeWin._pixelToggleSection(hide);
  }
  setDirtyPages(d => new Set([...d, currentPage]));
  setSectionAction(null);
  setSectionHover(null);
}
```

### 2F — Section hover overlay UI (renders over the iframe)

This is a thin teal border + a floating action button that appears when hovering over a section. Rendered `position:fixed` using `iframeRect` + `sectionHover.rect`:

```tsx
{sectionHover && iframeRect && sectionHover.rect && (
  <div
    style={{
      position: 'fixed',
      top: iframeRect.top + sectionHover.rect.top,
      left: iframeRect.left + sectionHover.rect.left,
      width: Math.min(sectionHover.rect.width, iframeRect.width),
      height: sectionHover.rect.height,
      zIndex: 2147483644,
      pointerEvents: 'none',
      border: '2px dashed rgba(42,124,111,0.4)',
      borderRadius: 4,
    }}
  />
)}
```

### 2G — Section click action popover

When `sectionAction` is set (user clicked a section), show a small popover (near sectionHover.rect) with two buttons: "Hide this section" or "Show section" (depending on current state):

```tsx
{sectionAction && sectionHover && iframeRect && (
  <div
    style={{
      position: 'fixed',
      top: iframeRect.top + sectionHover.rect.top + 12,
      left: iframeRect.left + sectionHover.rect.left + 12,
      zIndex: 2147483645,
      background: 'white',
      borderRadius: 10,
      boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
      border: '1px solid #e5e7eb',
      padding: '10px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 200,
    }}
  >
    <div className="text-[11px] text-gray-400 font-medium">
      Section: <span className="text-gray-600">.{sectionHover.sectionClass.split(' ')[0]}</span>
    </div>
    {sectionAction.isHidden ? (
      <button
        onClick={() => toggleSection(false)}
        className="text-xs bg-zing-teal text-white px-3 py-2 rounded-lg hover:bg-teal-700 text-left"
      >
        👁 Show this section
      </button>
    ) : (
      <button
        onClick={() => toggleSection(true)}
        className="text-xs bg-red-50 text-red-600 px-3 py-2 rounded-lg hover:bg-red-100 text-left"
      >
        🙈 Hide this section
      </button>
    )}
    <button
      onClick={() => setSectionAction(null)}
      className="text-xs text-gray-400 hover:text-gray-600 text-left"
    >
      Cancel
    </button>
  </div>
)}
```

### 2H — Hidden section placeholder in live preview

When a section is hidden (`data-pixel-hidden="true"`, `display:none`), the editor should still show a placeholder so the user knows it's there. This is done in the injection script by replacing hidden sections' display in the EDITOR ONLY (not in the deployed HTML — `display:none` is correct for the live site).

In `init()`, after setting up sections, add:

```javascript
// Show hidden sections as collapsed placeholders in editor view
document.querySelectorAll('[data-pixel-hidden="true"]').forEach(function(section) {
  section.style.display = 'block'; // override the none so it's visible in editor
  section.style.opacity = '0.3';
  section.style.minHeight = '40px';
  section.style.background = 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#e5e7eb 10px,#e5e7eb 20px)';
  section.style.border = '2px dashed #9ca3af';
  section.style.borderRadius = '4px';
});
```

---

## Verification

```bash
cd ~/Projects/zing-pixel-dashboard

# Build passes
npm run build && echo "BUILD OK"

# PIXEL_LINK_CLICK in injection script
grep -q "PIXEL_LINK_CLICK" "app/dashboard/sites/[siteId]/page.tsx" && echo "LINK_CLICK OK"

# _pixelSetLinkHref exposed
grep -q "_pixelSetLinkHref" "app/dashboard/sites/[siteId]/page.tsx" && echo "SET_LINK_HREF OK"

# linkEdit state
grep -q "linkEdit" "app/dashboard/sites/[siteId]/page.tsx" && echo "LINK_STATE OK"

# PIXEL_SECTION_HOVER in injection script
grep -q "PIXEL_SECTION_HOVER" "app/dashboard/sites/[siteId]/page.tsx" && echo "SECTION_HOVER OK"

# _pixelToggleSection exposed
grep -q "_pixelToggleSection" "app/dashboard/sites/[siteId]/page.tsx" && echo "TOGGLE_SECTION OK"

# sectionHover state
grep -q "sectionHover" "app/dashboard/sites/[siteId]/page.tsx" && echo "SECTION_STATE OK"
```

## Commit and push

```bash
git add -A && git commit -m "feat: link URL editing + section visibility toggle

- Click any <a> in preview: popover with current URL, edit + save via _pixelSetLinkHref
- Hover any section: dashed teal border overlay shows section boundary
- Click section: popover with Hide/Show button; changes go through PIXEL_TEXT_CHANGE
- Hidden sections shown as striped placeholder in editor view (display:none in deployed HTML)
- Both features use PIXEL_TEXT_CHANGE so changes land in localPages and are deployable" && git push
```

## Completion

Output: <promise>LINK_SECTION_DONE</promise>
