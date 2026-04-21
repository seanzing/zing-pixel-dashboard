"use client";

import { useState, useRef, useEffect } from "react";
import FontPicker from "@/components/FontPicker";

export interface SelectionState {
  isEditing: boolean;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  align: string;
  fontSize: number;
  color: string;
  hasSelection: boolean;
  elementTag: string;
  elementRect: { top: number; left: number; bottom: number; right: number };
}

interface PixelToolbarProps {
  state: SelectionState | null;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  iframeRect: DOMRect | null;
  onFontSelect: (family: string, linkHref: string) => void;
}

const PALETTE = [
  "#000000","#1f2937","#374151","#6b7280","#9ca3af","#e5e7eb","#f9fafb","#ffffff",
  "#7f1d1d","#b91c1c","#ef4444","#f97316","#f59e0b","#fbbf24","#fde68a","#fef9c3",
  "#14532d","#16a34a","#4ade80","#0d9488","#22d3ee","#3b82f6","#6366f1","#a855f7",
  "#2a7c6f","#1e3530","#1d4ed8","#7c3aed","#be185d","#ec4899","#9f1239","#4c1d95",
];

const TOOLBAR_HEIGHT = 44;

export default function PixelToolbar({ state, iframeRef, iframeRect, onFontSelect }: PixelToolbarProps) {
  const [showColorPanel, setShowColorPanel] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [currentFont, setCurrentFont] = useState<string | undefined>();
  const [colorHex, setColorHex] = useState("#000000");
  const [fontSize, setFontSize] = useState<string>("");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const colorPanelRef = useRef<HTMLDivElement>(null);
  const savedRangeRef = useRef<Range | null>(null);
  const aaButtonRef = useRef<HTMLButtonElement>(null);

  // --- Direct iframe access helpers ---
  function getIframeDoc() {
    return iframeRef.current?.contentDocument ?? null;
  }
  function getIframeWin() {
    return iframeRef.current?.contentWindow ?? null;
  }
  function getEditingEl(): HTMLElement | null {
    return (getIframeDoc()?.querySelector('[contenteditable="true"]') as HTMLElement) ?? null;
  }

  // Save iframe selection on mousedown (before focus moves to parent)
  function saveIframeSelection() {
    const sel = getIframeWin()?.getSelection();
    if (sel && sel.rangeCount > 0) {
      try { savedRangeRef.current = sel.getRangeAt(0).cloneRange(); } catch { /* noop */ }
    }
  }

  // Refocus iframe editing element and restore selection
  function restoreIframeFocus() {
    const el = getEditingEl();
    const iframeWin = getIframeWin();
    if (!el || !iframeWin) return false;
    el.focus({ preventScroll: true });
    if (savedRangeRef.current) {
      try {
        const sel = iframeWin.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(savedRangeRef.current); }
      } catch { /* noop */ }
    }
    return true;
  }

  // Execute a formatting command directly on the iframe document
  function execCmd(cmd: string, value?: string) {
    if (!restoreIframeFocus()) return;
    const doc = getIframeDoc();
    if (!doc) return;
    doc.execCommand('styleWithCSS', false, 'true');
    doc.execCommand(cmd, false, value ?? '');
  }

  // Sync font size from state
  useEffect(() => {
    if (state) setFontSize(String(state.fontSize || ""));
  }, [state?.fontSize]);

  // Close panels when editing ends
  useEffect(() => {
    if (!state) { setShowColorPanel(false); setShowFontPicker(false); }
  }, [state]);

  // Close color panel on click outside
  useEffect(() => {
    if (!showColorPanel) return;
    function handleClick(e: MouseEvent) {
      if (colorPanelRef.current && !colorPanelRef.current.contains(e.target as Node)) {
        setShowColorPanel(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColorPanel]);

  if (!state || !state.isEditing || !iframeRect) return null;

  function sendConvertTag(tag: string) {
    iframeRef.current?.contentWindow?.postMessage({ type: "PIXEL_CONVERT_TAG", tag }, "*");
  }

  function sendConvertList(listTag: string) {
    iframeRef.current?.contentWindow?.postMessage({ type: "PIXEL_CONVERT_LIST", listTag }, "*");
  }

  function applyColor(color: string) {
    if (!restoreIframeFocus()) return;
    const doc = getIframeDoc();
    if (!doc) return;
    const sel = getIframeWin()?.getSelection();
    if (sel && !sel.isCollapsed) {
      doc.execCommand('styleWithCSS', false, 'true');
      doc.execCommand('foreColor', false, color);
    } else {
      const el = getEditingEl();
      if (el) el.style.color = color;
    }
    setColorHex(color);
    setShowColorPanel(false);
  }

  function applyAlign(align: string) {
    // Style-only — no execCommand needed, no focus needed
    const el = getEditingEl();
    if (el) el.style.textAlign = align;
  }

  function applyFontSize(size: number) {
    // Style-only — no execCommand needed, no focus needed
    const el = getEditingEl();
    if (el) el.style.fontSize = size + 'px';
  }

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
  }

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

  // Position: above the editing element, converted from iframe coords to parent viewport
  const top = iframeRect.top + state.elementRect.top - TOOLBAR_HEIGHT - 10;
  const left = iframeRect.left + state.elementRect.left;
  const clampedTop = Math.max(4, top < 4 ? iframeRect.top + state.elementRect.bottom + 10 : top);
  const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - 600));

  const alignSvgs = {
    left: '<svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor"><rect x="0" y="0" width="13" height="1.8" rx="0.9"/><rect x="0" y="4.6" width="9" height="1.8" rx="0.9"/><rect x="0" y="9.2" width="11" height="1.8" rx="0.9"/></svg>',
    center: '<svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor"><rect x="0" y="0" width="13" height="1.8" rx="0.9"/><rect x="2" y="4.6" width="9" height="1.8" rx="0.9"/><rect x="1" y="9.2" width="11" height="1.8" rx="0.9"/></svg>',
    right: '<svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor"><rect x="0" y="0" width="13" height="1.8" rx="0.9"/><rect x="4" y="4.6" width="9" height="1.8" rx="0.9"/><rect x="2" y="9.2" width="11" height="1.8" rx="0.9"/></svg>',
  };

  function btnClass(active: boolean) {
    return `bg-transparent border-none text-xs font-bold px-[7px] py-[4px] rounded-[5px] cursor-pointer leading-none min-w-[24px] ${
      active ? "bg-[#2a7c6f] text-white" : "text-[#d1d5db] hover:bg-[#374151] hover:text-white"
    }`;
  }

  return (
    <div
      ref={toolbarRef}
      onMouseDown={(e) => {
        // Always save iframe selection before focus moves to parent.
        // Inputs are excluded from e.preventDefault() so they stay typeable.
        saveIframeSelection();
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT") e.preventDefault();
      }}
      style={{
        position: "fixed",
        top: clampedTop,
        left: clampedLeft,
        zIndex: 2147483647,
      }}
      className="flex items-center gap-[2px] bg-[#1a1d21] rounded-[9px] px-[7px] py-[5px] shadow-[0_6px_24px_rgba(0,0,0,0.4)] select-none font-[system-ui,sans-serif]"
    >
      {/* Bold / Italic / Underline / Strikethrough */}
      <button className={btnClass(state.bold)} onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => execCmd("bold")}>
        <b>B</b>
      </button>
      <button className={btnClass(state.italic)} onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => execCmd("italic")}>
        <i style={{ fontStyle: "italic" }}>I</i>
      </button>
      <button className={btnClass(state.underline)} onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => execCmd("underline")}>
        <u style={{ textDecoration: "underline" }}>U</u>
      </button>
      <button className={btnClass(state.strikethrough)} onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => execCmd("strikeThrough")}>
        <s>S</s>
      </button>

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Color button + panel */}
      <div className="relative inline-flex" ref={colorPanelRef}>
        <button
          className={btnClass(false)}
          title="Text color"
          onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); setShowColorPanel((p) => !p); }}
        >
          <span style={{ fontWeight: 700, fontSize: 13, borderBottom: `3px solid ${state.color || "#ffffff"}`, paddingBottom: 0, lineHeight: "1.2", display: "inline-block" }}>
            A
          </span>
        </button>
        {showColorPanel && (
          <div
            style={{ position: "absolute", top: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)" }}
            className="bg-white rounded-[10px] p-[10px] shadow-[0_8px_28px_rgba(0,0,0,0.22)] z-[1] w-[186px]"
          >
            <div className="grid grid-cols-8 gap-[3px] mb-2">
              {PALETTE.map((color) => (
                <div
                  key={color}
                  title={color}
                  className="w-[18px] h-[18px] rounded cursor-pointer border-2 border-transparent hover:scale-[1.2] hover:border-[#2a7c6f] transition-transform"
                  style={{
                    background: color,
                    ...(color === "#ffffff" ? { border: "2px solid #e5e7eb" } : {}),
                  }}
                  onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
                  onClick={() => applyColor(color)}
                />
              ))}
            </div>
            <div className="flex items-center gap-[6px]">
              <div className="w-[22px] h-[22px] rounded-[5px] border-[1.5px] border-[#e5e7eb] shrink-0" style={{ background: colorHex }} />
              <input
                type="text"
                placeholder="#000000"
                maxLength={7}
                value={colorHex}
                onChange={(e) => {
                  setColorHex(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const val = colorHex.startsWith("#") ? colorHex : "#" + colorHex;
                    if (/^#[0-9a-fA-F]{6}$/.test(val)) applyColor(val);
                  }
                }}
                className="flex-1 bg-[#f9fafb] border border-[#e5e7eb] rounded-[5px] text-[#374151] text-[11px] font-mono px-[6px] py-[3px] outline-none focus:border-[#2a7c6f]"
              />
              <button
                className="bg-[#2a7c6f] text-white border-none rounded-[5px] text-[11px] font-bold px-[7px] py-[3px] cursor-pointer hover:bg-[#1e3530]"
                onMouseDown={(e) => {
                  e.preventDefault();
                  saveIframeSelection();
                }}
                onClick={() => {
                  const val = colorHex.startsWith("#") ? colorHex : "#" + colorHex;
                  if (/^#[0-9a-fA-F]{6}$/.test(val)) applyColor(val);
                }}
              >
                ↵
              </button>
            </div>
            <span
              className="text-[10px] text-[#6b7280] cursor-pointer underline block text-center mt-[6px] hover:text-[#374151]"
              onMouseDown={(e) => {
                e.preventDefault();
                saveIframeSelection();
              }}
              onClick={() => {
                clearFormatting();
                setShowColorPanel(false);
              }}
            >
              Remove color
            </span>
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Alignment */}
      {(["left", "center", "right"] as const).map((align) => (
        <button
          key={align}
          className={btnClass(state.align === align)}
          title={`Align ${align}`}
          onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
          onClick={() => applyAlign(align)}
          dangerouslySetInnerHTML={{ __html: alignSvgs[align] }}
        />
      ))}

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Clear formatting */}
      <button className={btnClass(false)} title="Clear formatting" onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => clearFormatting()}>
        &#8855;
      </button>

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Lists */}
      <button className={btnClass(false)} title="Bullet list" onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => sendConvertList("ul")}>
        &#8226;&#8213;
      </button>
      <button className={btnClass(false)} title="Numbered list" onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }} onClick={() => sendConvertList("ol")}>
        1&#8213;
      </button>

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Tag conversion */}
      {["h1", "h2", "h3", "h4", "p"].map((tag) => (
        <button
          key={tag}
          className={btnClass(state.elementTag === tag)}
          title={`Convert to <${tag}>`}
          onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
          onClick={() => sendConvertTag(tag)}
        >
          {tag.toUpperCase()}
        </button>
      ))}

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Font size */}
      <span className="text-[#6b7280] text-[10px] px-[2px] pl-[4px]">px</span>
      <input
        type="number"
        min={8}
        max={200}
        placeholder="–"
        value={fontSize}
        onChange={(e) => setFontSize(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            const px = parseInt(fontSize);
            if (px > 0) applyFontSize(px);
          }
        }}
        onBlur={() => {
          const px = parseInt(fontSize);
          if (px > 0) applyFontSize(px);
        }}
        className="w-[44px] bg-[#374151] border border-[#4b5563] rounded-[5px] text-[#e5e7eb] text-xs font-semibold px-[5px] py-[3px] text-center outline-none focus:border-[#2a7c6f] focus:bg-[#1f2937] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />

      <div className="w-px h-4 bg-[#374151] mx-[3px] shrink-0" />

      {/* Font picker */}
      <button
        ref={aaButtonRef}
        className={btnClass(false)}
        title="Font family"
        onMouseDown={(e) => { e.preventDefault(); saveIframeSelection(); }}
        onClick={() => setShowFontPicker(p => !p)}
      >
        Aa
      </button>

      {showFontPicker && (
        <div
          style={{
            position: 'fixed',
            top: clampedTop + TOOLBAR_HEIGHT + 8,
            left: Math.min(clampedLeft + 400, window.innerWidth - 320),
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
    </div>
  );
}
