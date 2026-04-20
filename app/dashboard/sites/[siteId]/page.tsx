"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import FontPicker from "@/components/FontPicker";


interface Site {
  id: string;
  business_name: string;
  owner_email: string;
  phone: string;
  email: string;
  address: string;
  hours: string;
  hero_headline: string;
  hero_subheadline: string;
  cta_text: string;
  status: string;
  preview_url: string | null;
  live_url: string | null;
}

interface Version {
  sha: string;
  message: string;
  author: string;
  date: string;
}

interface EditLogEntry {
  id: string;
  action: string;
  summary: string;
  user_email: string | null;
  created_at: string;
}

interface Deployment {
  id: string;
  type: string;
  url: string;
  deployed_at: string;
  deployed_by: string | null;
}

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export default function SiteEditorPage() {
  const { siteId } = useParams<{ siteId: string }>();
  const router = useRouter();
  const [site, setSite] = useState<Site | null>(null);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<{
    filename: string;
    url: string;
  } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [extracting, setExtracting] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [editLog, setEditLog] = useState<EditLogEntry[]>([]);
  const [bottomTab, setBottomTab] = useState<"deployments" | "activity" | "versions" | "locations">("deployments");
  const [locations, setLocations] = useState<Array<{ slug: string; label: string; url: string }>>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [locationsMeta, setLocationsMeta] = useState<{ indexUrl: string | null; total: number } | null>(null);
  const [locationPreview, setLocationPreview] = useState<string | null>(null);

  // Concurrent edit conflict
  const [conflictError, setConflictError] = useState<string | null>(null);

  // Local HTML edit state (undo/redo)
  // Per-page local edit state — all pages held in memory simultaneously
  const [localPages, setLocalPages] = useState<Record<string, string>>({});
  const [undoStacks, setUndoStacks] = useState<Record<string, string[]>>({});
  const [redoStacks, setRedoStacks] = useState<Record<string, string[]>>({});
  const [dirtyPages, setDirtyPages] = useState<Set<string>>(new Set());
  const [htmlDeploying, setHtmlDeploying] = useState(false);

  // Text editing state
  const [textEditing, setTextEditing] = useState(false);
  const [showFontPicker, setShowFontPicker] = useState(false);
  const [currentFont, setCurrentFont] = useState<string | undefined>();
  const pendingRebuildRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Click-to-replace image state
  const [selectedImg, setSelectedImg] = useState<{ index: number; rawSrc: string; resolvedSrc: string; kind: "img" | "bg" } | null>(null);
  const [imgReplaceFile, setImgReplaceFile] = useState<File | null>(null);
  const [imgReplacing, setImgReplacing] = useState(false);
  const [imgReplaceError, setImgReplaceError] = useState("");
  const [imgReplaceSuccess, setImgReplaceSuccess] = useState(false);
  const imgReplaceInputRef = useRef<HTMLInputElement>(null);

  // Multi-page state
  type PageEntry = { filename: string; label: string; isHome: boolean; slug: string };
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [currentPage, setCurrentPage] = useState("index.html");

  // Derived per-page aliases (after currentPage is declared)
  const localHtml = localPages[currentPage] ?? null;
  const undoStack = undoStacks[currentPage] ?? [];
  const redoStack = redoStacks[currentPage] ?? [];
  const isDirty = dirtyPages.has(currentPage);
  const dirtyCount = dirtyPages.size;

  // Per-page state mutation helpers
  function setPageHtml(page: string, html: string) {
    setLocalPages(prev => ({ ...prev, [page]: html }));
  }
  function markDirty(page: string) {
    setDirtyPages(prev => new Set([...prev, page]));
  }
  function markClean(page: string) {
    setDirtyPages(prev => { const n = new Set(prev); n.delete(page); return n; });
  }
  function pushUndo(page: string, html: string) {
    setUndoStacks(prev => ({ ...prev, [page]: [...(prev[page] ?? []), html] }));
  }
  function clearPageHistory(page: string) {
    setUndoStacks(prev => { const n = { ...prev }; delete n[page]; return n; });
    setRedoStacks(prev => { const n = { ...prev }; delete n[page]; return n; });
  }

  const [showNewPageModal, setShowNewPageModal] = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [newPageSlug, setNewPageSlug] = useState("");
  const [newPageCloneFrom, setNewPageCloneFrom] = useState("index.html");
  const [newPageAddToNav, setNewPageAddToNav] = useState(true);
  const [newPageCreating, setNewPageCreating] = useState(false);
  const [newPageError, setNewPageError] = useState("");

  // Left panel tabs
  const [leftTab, setLeftTab] = useState<"details" | "seo" | "images">("details");

  // SEO panel state
  const [seoData, setSeoData] = useState<{ title: string; description: string; canonical: string; ogTitle: string; ogDescription: string; ogImage: string; h1: string } | null>(null);
  const [seoSha, setSeoSha] = useState<string>("");
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoSaving, setSeoSaving] = useState(false);
  const [seoSaved, setSeoSaved] = useState(false);

  // Images/alt text panel state
  type ImgEntry = { index: number; src: string; alt: string; previewUrl: string; context: string };
  const [imgList, setImgList] = useState<ImgEntry[]>([]);
  const [imgSha, setImgSha] = useState<string>("");
  const [imgLoading, setImgLoading] = useState(false);
  const [imgSaving, setImgSaving] = useState(false);
  const [imgSaved, setImgSaved] = useState(false);
  const [imgGenerating, setImgGenerating] = useState(false);
  const [imgGenProgress, setImgGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [imgGeneratingIndex, setImgGeneratingIndex] = useState<number | null>(null);

  // Generate locations modal
  const [showLocModal, setShowLocModal] = useState(false);
  const [locCity, setLocCity] = useState("");
  const [locState, setLocState] = useState("");
  const [locCount, setLocCount] = useState("50");
  const [locRunning, setLocRunning] = useState(false);
  const [locLog, setLocLog] = useState<Array<{ type: "progress" | "page" | "done" | "error"; text: string; status?: string }>>([]);
  const [locDone, setLocDone] = useState(false);

  // Custom domain
  const [domainInput, setDomainInput] = useState("");
  const [domainStatus, setDomainStatus] = useState<"idle" | "adding" | "pending" | "active" | "error">("idle");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [cnameTarget, setCnameTarget] = useState<string | null>(null);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [removingDomain, setRemovingDomain] = useState(false);
  const domainPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Inject <base href> so relative asset paths resolve to the deployed CF Pages origin
  function buildBlobPreview(html: string, siteId: string, interactive = false): string {
    const base = `<base href="https://${siteId}.pages.dev/">`;
    const interactionScript = interactive ? `
<style>
  [data-pixel-el] { cursor: pointer !important; }
  [data-pixel-el]:hover:not([data-pixel-selected]) { outline: 2px dashed #2a7c6f !important; outline-offset: 3px !important; }
  [data-pixel-el][data-pixel-selected] { outline: 3px solid #2a7c6f !important; outline-offset: 3px !important; box-shadow: 0 0 0 6px rgba(42,124,111,0.15) !important; }
  [data-pixel-text]:not([contenteditable="true"]) { cursor: text !important; }
  [data-pixel-text]:not([contenteditable="true"]):hover { outline: 2px dashed #2a7c6f !important; outline-offset: 2px !important; }
  [data-pixel-text][contenteditable="true"] { outline: 2px solid #2a7c6f !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(42,124,111,0.12) !important; }
  #pixel-toolbar { position:fixed;display:none;align-items:center;gap:2px;background:#1a1d21;border-radius:9px;padding:5px 7px;box-shadow:0 6px 24px rgba(0,0,0,0.4);z-index:2147483647;user-select:none;font-family:system-ui,sans-serif; }
  #pixel-toolbar button { background:transparent;border:none;color:#d1d5db;font-size:12px;font-weight:700;padding:4px 7px;border-radius:5px;cursor:pointer;line-height:1;min-width:24px; }
  #pixel-toolbar button:hover { background:#374151;color:#fff; }
  #pixel-toolbar button.px-active { background:#2a7c6f;color:#fff; }
  #pixel-toolbar .px-sep { width:1px;height:16px;background:#374151;margin:0 3px;flex-shrink:0; }
  #pixel-toolbar .px-label { color:#6b7280;font-size:10px;padding:0 2px 0 4px; }
  #pixel-toolbar input[type=number] { width:44px;background:#374151;border:1px solid #4b5563;border-radius:5px;color:#e5e7eb;font-size:12px;font-weight:600;padding:3px 5px;text-align:center;outline:none; }
  #pixel-toolbar input[type=number]:focus { border-color:#2a7c6f;background:#1f2937; }
  #pixel-toolbar input[type=number]::-webkit-inner-spin-button,#pixel-toolbar input[type=number]::-webkit-outer-spin-button { -webkit-appearance:none; }
  .px-color-wrap { position:relative;display:inline-flex; }
  #pixel-color-panel { position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);background:#fff;border-radius:10px;padding:10px;box-shadow:0 8px 28px rgba(0,0,0,0.22);z-index:1;width:186px; }
  .px-swatches { display:grid;grid-template-columns:repeat(8,18px);gap:3px;margin-bottom:8px; }
  .px-swatch { width:18px;height:18px;border-radius:4px;cursor:pointer;border:2px solid transparent;box-sizing:border-box;transition:transform 0.1s,border-color 0.1s; }
  .px-swatch:hover { transform:scale(1.2);border-color:#2a7c6f; }
  .px-swatch[data-selected] { border-color:#2a7c6f; }
  .px-color-row { display:flex;align-items:center;gap:6px; }
  #pixel-color-preview { width:22px;height:22px;border-radius:5px;border:1.5px solid #e5e7eb;flex-shrink:0; }
  #pixel-color-hex { flex:1;background:#f9fafb;border:1px solid #e5e7eb;border-radius:5px;color:#374151;font-size:11px;font-family:monospace;padding:3px 6px;outline:none; }
  #pixel-color-hex:focus { border-color:#2a7c6f; }
  #pixel-color-apply { background:#2a7c6f;color:#fff;border:none;border-radius:5px;font-size:11px;font-weight:700;padding:3px 7px;cursor:pointer; }
  #pixel-color-apply:hover { background:#1e3530; }
  #pixel-color-none { font-size:10px;color:#6b7280;cursor:pointer;text-decoration:underline;display:block;text-align:center;margin-top:6px; }
  #pixel-color-none:hover { color:#374151; }
</style>
<script>
(function() {
  'use strict';
  var _imgSelected = null;
  var _editingEl = null;
  var _editingOrigHtml = '';
  var toolbar, pxInput;

  // ─── Toolbar Build ────────────────────────────────────────────────────────
  function initToolbar() {
    toolbar = document.createElement('div');
    toolbar.id = 'pixel-toolbar';

    function btn(html, title, attrs) {
      var b = document.createElement('button');
      b.innerHTML = html; b.title = title || '';
      if (attrs) Object.keys(attrs).forEach(function(k) { b.setAttribute(k, attrs[k]); });
      toolbar.appendChild(b); return b;
    }
    function sep() { var s = document.createElement('div'); s.className = 'px-sep'; toolbar.appendChild(s); }
    function label(t) { var l = document.createElement('span'); l.className = 'px-label'; l.textContent = t; toolbar.appendChild(l); }

    btn('<b>B</b>', 'Bold', {'data-cmd':'bold'});
    btn('<i style="font-style:italic">I</i>', 'Italic', {'data-cmd':'italic'});
    btn('<u style="text-decoration:underline">U</u>', 'Underline', {'data-cmd':'underline'});
    btn('<s>S</s>', 'Strikethrough', {'data-cmd':'strikeThrough'});
    sep();

    // Text color button + panel
    var colorWrap = document.createElement('div');
    colorWrap.className = 'px-color-wrap';
    var colorBtn = document.createElement('button');
    colorBtn.id = 'pixel-color-btn';
    colorBtn.title = 'Text color';
    colorBtn.innerHTML = '<span id="pixel-color-indicator" style="font-weight:700;font-size:13px;border-bottom:3px solid #ffffff;padding-bottom:0px;line-height:1.2;display:inline-block">A</span>';
    colorWrap.appendChild(colorBtn);

    var colorPanel = document.createElement('div');
    colorPanel.id = 'pixel-color-panel';
    colorPanel.style.display = 'none';
    var PALETTE = [
      '#000000','#1f2937','#374151','#6b7280','#9ca3af','#e5e7eb','#f9fafb','#ffffff',
      '#7f1d1d','#b91c1c','#ef4444','#f97316','#f59e0b','#fbbf24','#fde68a','#fef9c3',
      '#14532d','#16a34a','#4ade80','#0d9488','#22d3ee','#3b82f6','#6366f1','#a855f7',
      '#2a7c6f','#1e3530','#1d4ed8','#7c3aed','#be185d','#ec4899','#9f1239','#4c1d95',
    ];
    var swatchGrid = document.createElement('div');
    swatchGrid.className = 'px-swatches';
    PALETTE.forEach(function(color) {
      var sw = document.createElement('div');
      sw.className = 'px-swatch';
      sw.style.background = color;
      sw.title = color;
      if (color === '#ffffff') sw.style.border = '2px solid #e5e7eb';
      sw.addEventListener('mousedown', function(e) { e.preventDefault(); applyColor(color); });
      swatchGrid.appendChild(sw);
    });
    colorPanel.appendChild(swatchGrid);
    var colorRow = document.createElement('div');
    colorRow.className = 'px-color-row';
    var colorPreview = document.createElement('div');
    colorPreview.id = 'pixel-color-preview';
    colorPreview.style.background = '#000000';
    var colorHex = document.createElement('input');
    colorHex.type = 'text'; colorHex.id = 'pixel-color-hex';
    colorHex.placeholder = '#000000'; colorHex.maxLength = 7;
    var colorApply = document.createElement('button');
    colorApply.id = 'pixel-color-apply'; colorApply.textContent = '↵';
    colorApply.title = 'Apply color';
    colorRow.appendChild(colorPreview); colorRow.appendChild(colorHex); colorRow.appendChild(colorApply);
    colorPanel.appendChild(colorRow);
    var colorNone = document.createElement('span');
    colorNone.id = 'pixel-color-none'; colorNone.textContent = 'Remove color';
    colorPanel.appendChild(colorNone);
    colorWrap.appendChild(colorPanel);
    toolbar.appendChild(colorWrap);

    // Color panel logic
    function applyColor(color) {
      if (!_editingEl) return;
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, color);
      var ind = document.getElementById('pixel-color-indicator');
      if (ind) ind.style.borderBottomColor = color;
      colorPreview.style.background = color;
      colorHex.value = color;
      colorPanel.style.display = 'none';
      _editingEl.focus();
    }
    colorBtn.addEventListener('click', function() {
      colorPanel.style.display = colorPanel.style.display === 'none' ? 'block' : 'none';
    });
    colorHex.addEventListener('input', function() {
      var val = colorHex.value.startsWith('#') ? colorHex.value : '#' + colorHex.value;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) colorPreview.style.background = val;
    });
    colorHex.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); var val = colorHex.value.startsWith('#') ? colorHex.value : '#' + colorHex.value; if (/^#[0-9a-fA-F]{6}$/.test(val)) applyColor(val); }
    });
    colorApply.addEventListener('mousedown', function(e) {
      e.preventDefault();
      var val = colorHex.value.startsWith('#') ? colorHex.value : '#' + colorHex.value;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) applyColor(val);
    });
    colorNone.addEventListener('mousedown', function(e) {
      e.preventDefault();
      if (!_editingEl) return;
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('foreColor', false, 'inherit');
      var ind = document.getElementById('pixel-color-indicator');
      if (ind) ind.style.borderBottomColor = '#ffffff';
      colorPanel.style.display = 'none';
      _editingEl.focus();
    });
    sep();

    // Alignment
    var alignSvgs = {
      left: '<svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor"><rect x="0" y="0" width="13" height="1.8" rx="0.9"/><rect x="0" y="4.6" width="9" height="1.8" rx="0.9"/><rect x="0" y="9.2" width="11" height="1.8" rx="0.9"/></svg>',
      center: '<svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor"><rect x="0" y="0" width="13" height="1.8" rx="0.9"/><rect x="2" y="4.6" width="9" height="1.8" rx="0.9"/><rect x="1" y="9.2" width="11" height="1.8" rx="0.9"/></svg>',
      right: '<svg width="13" height="11" viewBox="0 0 13 11" fill="currentColor"><rect x="0" y="0" width="13" height="1.8" rx="0.9"/><rect x="4" y="4.6" width="9" height="1.8" rx="0.9"/><rect x="2" y="9.2" width="11" height="1.8" rx="0.9"/></svg>',
    };
    btn(alignSvgs.left, 'Align left', {'data-align':'left'});
    btn(alignSvgs.center, 'Align center', {'data-align':'center'});
    btn(alignSvgs.right, 'Align right', {'data-align':'right'});
    sep();

    btn('&#8855;', 'Clear formatting', {'data-action':'clear'});
    sep();

    btn('&#8226;&#8213;', 'Bullet list', {'data-list':'ul'});
    btn('1&#8213;', 'Numbered list', {'data-list':'ol'});
    sep();
    ['h1','h2','h3','h4','p'].forEach(function(tag) {
      btn(tag.toUpperCase(), 'Convert to &lt;' + tag + '&gt;', {'data-tag': tag});
    });
    sep();
    label('px');
    pxInput = document.createElement('input');
    pxInput.type = 'number'; pxInput.id = 'pixel-px-input';
    pxInput.placeholder = '–'; pxInput.min = '8'; pxInput.max = '200';
    toolbar.appendChild(pxInput);
    sep();
    btn('Aa', 'Font family', {'data-action': 'font'});

    document.body.appendChild(toolbar);

    // Toolbar mousedown — prevent blur on editing element
    toolbar.addEventListener('mousedown', function(e) {
      if (e.target !== pxInput) e.preventDefault();
    });

    toolbar.querySelectorAll('[data-cmd]').forEach(function(b) {
      b.addEventListener('click', function() {
        if (!_editingEl) return;
        document.execCommand(b.getAttribute('data-cmd'));
        _editingEl.focus();
        updateToolbarState();
      });
    });
    toolbar.querySelectorAll('[data-list]').forEach(function(b) {
      b.addEventListener('click', function() { convertToList(b.getAttribute('data-list')); });
    });
    toolbar.querySelectorAll('[data-tag]').forEach(function(b) {
      b.addEventListener('click', function() { convertTag(b.getAttribute('data-tag')); });
    });
    pxInput.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        var px = parseInt(pxInput.value);
        if (px > 0 && _editingEl) { _editingEl.style.fontSize = px + 'px'; _editingEl.focus(); }
      }
    });
    pxInput.addEventListener('change', function() {
      var px = parseInt(pxInput.value);
      if (px > 0 && _editingEl) _editingEl.style.fontSize = px + 'px';
    });

    // Alignment buttons
    toolbar.querySelectorAll('[data-align]').forEach(function(b) {
      b.addEventListener('click', function() {
        if (!_editingEl) return;
        _editingEl.style.textAlign = b.getAttribute('data-align');
        updateToolbarState();
      });
    });

    // Clear formatting
    toolbar.querySelectorAll('[data-action="clear"]').forEach(function(b) {
      b.addEventListener('click', function() {
        if (!_editingEl) return;
        document.execCommand('removeFormat');
        _editingEl.style.fontSize = '';
        _editingEl.style.fontFamily = '';
        _editingEl.style.textAlign = '';
        _editingEl.style.color = '';
        _editingEl.focus();
        updateToolbarState();
      });
    });

    // Aa button — opens font picker in parent
    toolbar.querySelectorAll('[data-action="font"]').forEach(function(b) {
      b.addEventListener('click', function() {
        window.parent.postMessage({ type: 'PIXEL_OPEN_FONT_PICKER' }, '*');
      });
    });
  }

  // ─── Toolbar State ────────────────────────────────────────────────────────
  function updateToolbarState() {
    if (!_editingEl || !toolbar) return;
    var tag = _editingEl.tagName.toLowerCase();
    // Tag buttons
    toolbar.querySelectorAll('[data-tag]').forEach(function(b) {
      b.classList.toggle('px-active', b.getAttribute('data-tag') === tag);
    });
    // Cmd state (bold, italic, underline, strikethrough)
    toolbar.querySelectorAll('[data-cmd]').forEach(function(b) {
      try { b.classList.toggle('px-active', document.queryCommandState(b.getAttribute('data-cmd'))); } catch(e) {}
    });
    // Alignment
    var align = _editingEl.style.textAlign || window.getComputedStyle(_editingEl).textAlign || 'left';
    toolbar.querySelectorAll('[data-align]').forEach(function(b) {
      b.classList.toggle('px-active', b.getAttribute('data-align') === align);
    });
    // Font size
    var fs = _editingEl.style.fontSize || window.getComputedStyle(_editingEl).fontSize;
    if (fs && pxInput) pxInput.value = parseInt(fs) || '';
    // Color indicator
    var color = window.getComputedStyle(_editingEl).color;
    if (color) {
      try {
        var m = color.match(/\d+/g);
        if (m && m.length >= 3) {
          var hex = '#' + [m[0],m[1],m[2]].map(function(n) { return ('0'+parseInt(n).toString(16)).slice(-2); }).join('');
          var ind = document.getElementById('pixel-color-indicator');
          if (ind) ind.style.borderBottomColor = hex;
          var prev = document.getElementById('pixel-color-preview');
          if (prev) prev.style.background = hex;
        }
      } catch(e) {}
    }
  }

  function positionToolbar(el) {
    toolbar.style.display = 'flex';
    var rect = el.getBoundingClientRect();
    var h = toolbar.offsetHeight || 44;
    var top = rect.top - h - 10;
    if (top < 4) top = rect.bottom + 10;
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - 400));
    toolbar.style.top = top + 'px'; toolbar.style.left = left + 'px';
  }

  // ─── Edit Session ─────────────────────────────────────────────────────────
  function cleanHtml(el) {
    var c = el.cloneNode(true);
    c.removeAttribute('contenteditable'); c.removeAttribute('data-pixel-text');
    return c.outerHTML;
  }

  function saveCurrentEdit() {
    if (!_editingEl) return;
    var el = _editingEl, orig = _editingOrigHtml;
    el.contentEditable = 'false';
    var newHtml = cleanHtml(el);
    if (newHtml !== orig) {
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:orig, newHtml:newHtml, needsRebuild:false }, '*');
      _editingOrigHtml = newHtml;
    }
    toolbar.style.display = 'none';
    var cp = document.getElementById('pixel-color-panel'); if (cp) cp.style.display = 'none';
    window.parent.postMessage({ type:'PIXEL_TEXT_END' }, '*');
    _editingEl = null; _editingOrigHtml = '';
  }

  function activateEdit(el, origHtml, cx, cy) {
    if (_editingEl && _editingEl !== el) saveCurrentEdit();
    _editingEl = el; _editingOrigHtml = origHtml;
    el.contentEditable = 'true'; el.focus();
    try {
      var r = document.caretRangeFromPoint(cx, cy);
      if (r) { var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); }
    } catch(err) {}
    positionToolbar(el); updateToolbarState();
    window.parent.postMessage({ type:'PIXEL_TEXT_START' }, '*');
  }

  // ─── Structural Actions ───────────────────────────────────────────────────
  function convertTag(newTag) {
    if (!_editingEl) return;
    var el = _editingEl, orig = _editingOrigHtml;
    el.contentEditable = 'false';
    var newEl = document.createElement(newTag);
    newEl.innerHTML = el.innerHTML;
    if (el.className) newEl.className = el.className;
    var pIdx = el.getAttribute('data-pixel-text');
    el.parentNode.replaceChild(newEl, el);
    var newHtml = newEl.outerHTML;
    if (newHtml !== orig) {
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:orig, newHtml:newHtml, needsRebuild:true }, '*');
    }
    // Re-establish editing on new element
    if (pIdx !== null) newEl.setAttribute('data-pixel-text', pIdx);
    _editingEl = newEl; _editingOrigHtml = newHtml;
    newEl.contentEditable = 'true'; newEl.focus();
    positionToolbar(newEl); updateToolbarState();
  }

  function convertToList(listTag) {
    if (!_editingEl) return;
    var el = _editingEl, orig = _editingOrigHtml;
    el.contentEditable = 'false';
    _editingEl = null; _editingOrigHtml = '';
    var list = document.createElement(listTag);
    var li = document.createElement('li');
    li.innerHTML = el.innerHTML;
    list.appendChild(li);
    el.parentNode.replaceChild(list, el);
    var newHtml = list.outerHTML;
    if (newHtml !== orig) {
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:orig, newHtml:newHtml, needsRebuild:true }, '*');
    }
    toolbar.style.display = 'none';
    window.parent.postMessage({ type:'PIXEL_TEXT_END' }, '*');
  }

  // ─── Global Listeners ─────────────────────────────────────────────────────
  document.addEventListener('focusout', function(e) {
    if (!_editingEl || e.target !== _editingEl) return;
    var rel = e.relatedTarget;
    if (rel && toolbar && toolbar.contains(rel)) return;
    // If focus went to the color hex input, don't save yet
    if (rel && rel.id === 'pixel-color-hex') return;
    saveCurrentEdit();
  });

  // Close color panel on click outside toolbar
  document.addEventListener('click', function(e) {
    var cp = document.getElementById('pixel-color-panel');
    if (cp && cp.style.display !== 'none' && !toolbar.contains(e.target)) {
      cp.style.display = 'none';
    }
  });

  document.addEventListener('keydown', function(e) {
    if (!_editingEl || !_editingEl.isContentEditable) return;
    if (e.key === 'Escape') { saveCurrentEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      var t = _editingEl.tagName.toLowerCase();
      if (t !== 'p' && t !== 'li') { e.preventDefault(); saveCurrentEdit(); }
    }
  });

  document.addEventListener('selectionchange', function() {
    if (_editingEl) updateToolbarState();
  });

  // ─── Image Clickable ──────────────────────────────────────────────────────
  function clearImgSelection() {
    if (!_imgSelected) return;
    delete _imgSelected.dataset.pixelSelected;
    _imgSelected.style.outline = ''; _imgSelected.style.outlineOffset = ''; _imgSelected.style.boxShadow = '';
    _imgSelected = null;
  }

  function makeImageClickable(el, index, kind, rawSrc) {
    el.setAttribute('data-pixel-el', '1');
    el.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (_editingEl) saveCurrentEdit();
      clearImgSelection();
      el.style.outline = '3px solid #2a7c6f'; el.style.outlineOffset = '3px';
      el.style.boxShadow = '0 0 0 6px rgba(42,124,111,0.15)';
      el.dataset.pixelSelected = '1'; _imgSelected = el;
      window.parent.postMessage({ type:'PIXEL_IMG_CLICK', index:index, kind:kind, rawSrc:rawSrc, resolvedSrc:(kind==='img')?el.src:rawSrc }, '*');
    });
  }

  // ─── Text Editable ────────────────────────────────────────────────────────
  function makeTextEditable(el, index) {
    var origHtml = el.outerHTML; // captured BEFORE data-pixel-text
    el.setAttribute('data-pixel-text', index);
    el.addEventListener('click', function(e) {
      if (e.target.closest('[data-pixel-el]')) return;
      e.stopPropagation();
      if (_imgSelected) { clearImgSelection(); window.parent.postMessage({ type:'PIXEL_DESELECT' }, '*'); }
      activateEdit(el, origHtml, e.clientX, e.clientY);
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    initToolbar();
    // Images
    document.querySelectorAll('img').forEach(function(img, i) {
      var raw = img.getAttribute('src') || '';
      if (!raw || raw.startsWith('data:')) return;
      makeImageClickable(img, i, 'img', raw);
    });
    var bgIdx = 0;
    document.querySelectorAll('[style*="background-image"]').forEach(function(el) {
      var m = el.style.backgroundImage.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (!m || !m[1] || m[1].startsWith('data:')) return;
      makeImageClickable(el, bgIdx++, 'bg', m[1]);
    });
    // Text
    var tIdx = 0;
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,button,[class*="btn"],[class*="cta"]').forEach(function(el) {
      if (el.querySelector('img') || !el.textContent.trim()) return;
      makeTextEditable(el, tIdx++);
    });
    document.querySelectorAll('p').forEach(function(el) {
      if (el.textContent.trim().length < 5 || el.querySelector('img')) return;
      makeTextEditable(el, tIdx++);
    });
    // Dismiss on blank area click
    document.addEventListener('click', function(e) {
      if (!_imgSelected) return;
      if (!e.target.closest('[data-pixel-el]') && !e.target.closest('[data-pixel-text]') && (!toolbar || !toolbar.contains(e.target))) {
        clearImgSelection();
        window.parent.postMessage({ type:'PIXEL_DESELECT' }, '*');
      }
    });
  }

  // Handle font application from parent
  window.addEventListener('message', function(e) {
    if (!e.data || e.data.type !== 'PIXEL_APPLY_FONT') return;
    var family = e.data.fontFamily;
    var href = e.data.linkHref;
    if (!family) return;
    // Inject link into head if not already present
    if (href && !document.querySelector('link[data-pixel-font="' + family + '"]')) {
      var link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      link.setAttribute('data-pixel-font', family);
      document.head.appendChild(link);
    }
    if (_editingEl) {
      _editingEl.style.fontFamily = "'" + family + "', " + (family.match(/[Mm]ono|[Cc]ode|[Cc]ourier|[Ss]pace [Mm]ono|[Ff]ira [Cc]ode/) ? 'monospace' : 'sans-serif');
      // Report back: the element change + the link tag to persist
      window.parent.postMessage({
        type: 'PIXEL_FONT_LINK',
        linkHref: href,
        fontFamily: family,
      }, '*');
      updateToolbarState();
    }
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>` : "";
    const inject = base + interactionScript;
    return html.includes("<head>")
      ? html.replace("<head>", `<head>${inject}`)
      : inject + html;
  }

  function revokeBlobUrl() {
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }
  }

  useEffect(() => () => revokeBlobUrl(), []); // cleanup on unmount

  // Right panel tab: "chat" | "preview"
  const [rightTab, setRightTab] = useState<"chat" | "preview" | "analytics">("chat");
  const [analyticsData, setAnalyticsData] = useState<{
    pageviews: number; visits: number;
    daily: Array<{ date: string; pageviews: number; visits: number }>;
    countries: Array<{ name: string; count: number }>;
    referrers: Array<{ host: string; count: number }>;
    devices: Array<{ type: string; count: number }>;
  } | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [previewKey, setPreviewKey] = useState(0); // increment to force iframe reload
  const [deviceView, setDeviceView] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // Deploy status polling
  type DeployState = "idle" | "queued" | "in_progress" | "success" | "failure";
  const [deployState, setDeployState] = useState<DeployState>("idle");
  const deployPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (deployPollRef.current) {
      clearInterval(deployPollRef.current);
      deployPollRef.current = null;
    }
  }, []);

  const pollDeployStatus = useCallback((sha: string) => {
    stopPolling();
    setDeployState("queued");

    deployPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/deploy-status?sha=${sha}`);
        const data = await res.json();

        if (data.status === "completed") {
          stopPolling();
          setDeployState(data.conclusion === "success" ? "success" : "failure");
          // Switch from blob preview back to the live CF Pages URL
          revokeBlobUrl();
          setPreviewKey((k) => k + 1);
          // Reset success badge after 8s
          setTimeout(() => setDeployState("idle"), 8000);
        } else {
          setDeployState(data.status === "in_progress" ? "in_progress" : "queued");
        }
      } catch {
        // Silently retry on network error
      }
    }, 5000);
  }, [stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function fetchSite() {
    const res = await fetch(`/api/sites/${siteId}?page=${currentPage}`);
    const data = await res.json();
    setSite(data.site);
    setDeployments(data.deployments ?? []);
    setEditLog(data.editLog ?? []);
    // Pre-fill location generator from site address
    if (data.site?.address) {
      const addrParts = (data.site.address as string).split(",").map((s: string) => s.trim());
      if (addrParts.length >= 2) {
        const stateZip = addrParts[addrParts.length - 1];
        const stateMatch = stateZip.match(/\b([A-Z]{2})\b/);
        if (stateMatch) setLocState(stateMatch[1]);
        if (addrParts.length >= 3) setLocCity(addrParts[addrParts.length - 2]);
      }
    }
    if (data.chatMessages) {
      setChatMessages(data.chatMessages);
    }
  }

  async function handleExtract() {
    if (!site) return;
    setExtracting(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/extract`);
      const data = await res.json();
      if (data.extracted) {
        setSite((prev) => {
          if (!prev) return prev;
          const e = data.extracted;
          return {
            ...prev,
            business_name: e.business_name ?? prev.business_name,
            phone: e.phone ?? prev.phone,
            email: e.email ?? prev.email,
            address: e.address ?? prev.address,
            hours: e.hours ?? prev.hours,
            hero_headline: e.hero_headline ?? prev.hero_headline,
            hero_subheadline: e.hero_subheadline ?? prev.hero_subheadline,
            cta_text: e.cta_text ?? prev.cta_text,
          };
        });
      }
    } finally {
      setExtracting(false);
    }
  }

  async function fetchAnalytics() {
    if (analyticsLoading || analyticsData) return;
    setAnalyticsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/analytics`);
      if (res.ok) setAnalyticsData(await res.json());
    } catch { /* ignore */ } finally {
      setAnalyticsLoading(false);
    }
  }

  async function loadInteractivePreview() {
    // Use local unsaved HTML if present, otherwise fetch from GitHub
    let html = localPages[currentPage] ?? null;
    if (!html) {
      const res = await fetch(`/api/sites/${siteId}/raw?page=${currentPage}`);
      if (!res.ok) return;
      const d = await res.json();
      html = d.html as string;
      setPageHtml(currentPage, html); // seed local state from GitHub
    }
    if (!html) return;
    revokeBlobUrl();
    const preview = buildBlobPreview(html, siteId, true);
    setBlobUrl(URL.createObjectURL(new Blob([preview], { type: "text/html" })));
    setPreviewKey((k) => k + 1);
  }

  async function deployPage(page: string): Promise<string | null> {
    const html = localPages[page];
    if (!html) return null;
    const res = await fetch(`/api/sites/${siteId}/deploy-html`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, page }),
    });
    const data = await res.json();
    if (data.conflict) { setConflictError(data.error); return null; }
    if (!res.ok) throw new Error(data.error ?? `Deploy failed for ${page}`);
    markClean(page);
    clearPageHistory(page);
    return data.commitSha as string;
  }

  async function deployLocalHtml() {
    if (!localHtml || !isDirty) return;
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

  async function deployAllPages() {
    if (dirtyCount === 0) return;
    setHtmlDeploying(true);
    let lastSha: string | null = null;
    try {
      for (const page of Array.from(dirtyPages)) {
        const sha = await deployPage(page);
        if (sha) lastSha = sha;
        await new Promise(r => setTimeout(r, 300)); // avoid SHA conflicts on sequential writes
      }
      if (lastSha) pollDeployStatus(lastSha);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setHtmlDeploying(false);
    }
  }

  async function handleImageReplace() {
    if (!imgReplaceFile || selectedImg === null) return;
    setImgReplacing(true);
    setImgReplaceError("");
    try {
      const form = new FormData();
      form.append("file", imgReplaceFile);
      form.append("page", currentPage);
      form.append("rawSrc", selectedImg.rawSrc);

      const res = await fetch(`/api/sites/${siteId}/images/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setImgReplaceError(data.error || "Upload failed");
        return;
      }
      // Image replace commits directly — sync local state so it stays consistent
      setPageHtml(currentPage, data.html);
      markClean(currentPage); // already committed
      clearPageHistory(currentPage);
      // Rebuild the blob preview with the updated HTML (interactive)
      revokeBlobUrl();
      const preview = buildBlobPreview(data.html, siteId, true);
      setBlobUrl(URL.createObjectURL(new Blob([preview], { type: "text/html" })));
      setPreviewKey((k) => k + 1);
      setImgReplaceSuccess(true);
      setSelectedImg(null);
      setImgReplaceFile(null);
      // Trigger CF Pages deploy (commit already happened in upload API)
      if (data.commitSha) pollDeployStatus(data.commitSha);
      setTimeout(() => setImgReplaceSuccess(false), 3000);
    } catch (err) {
      setImgReplaceError((err as Error).message);
    } finally {
      setImgReplacing(false);
    }
  }

  async function fetchPages() {
    try {
      const res = await fetch(`/api/sites/${siteId}/pages`);
      const data = await res.json();
      if (data.pages) setPages(data.pages);
    } catch { /* non-fatal */ }
  }

  async function createPage() {
    if (!newPageName.trim() || !newPageSlug.trim()) return;
    setNewPageCreating(true);
    setNewPageError("");
    try {
      const res = await fetch(`/api/sites/${siteId}/pages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newPageName.trim(),
          slug: newPageSlug.trim(),
          cloneFrom: newPageCloneFrom,
          addToNav: newPageAddToNav,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setNewPageError(data.error || "Failed to create page"); return; }
      await fetchPages();
      setCurrentPage(data.filename);
      setShowNewPageModal(false);
      setNewPageName("");
      setNewPageSlug("");
      setNewPageAddToNav(true);
      // Clear editor state for new page
      setChatMessages([]);
      setBlobUrl(null);
    } catch (err) {
      setNewPageError((err as Error).message);
    } finally {
      setNewPageCreating(false);
    }
  }

  async function deletePage(filename: string) {
    if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return;
    await fetch(`/api/sites/${siteId}/pages/${filename}`, { method: "DELETE" });
    await fetchPages();
    if (currentPage === filename) setCurrentPage("index.html");
  }

  async function fetchSeo() {
    setSeoLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/seo?page=${currentPage}`);
      const data = await res.json();
      if (data.seo) { setSeoData(data.seo); setSeoSha(data.sha); }
    } finally { setSeoLoading(false); }
  }

  async function saveSeo() {
    if (!seoData) return;
    setSeoSaving(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/seo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seo: seoData, sha: seoSha, page: currentPage }),
      });
      const data = await res.json();
      if (data.conflict) { setConflictError(data.error); return; }
      if (data.sha) setSeoSha(data.sha);
      setSeoSaved(true);
      setTimeout(() => setSeoSaved(false), 2500);
    } finally { setSeoSaving(false); }
  }

  async function fetchImages() {
    setImgLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/images?page=${currentPage}`);
      const data = await res.json();
      if (data.images) { setImgList(data.images); setImgSha(data.sha); }
    } finally { setImgLoading(false); }
  }

  async function generateAltText(indices?: number[]) {
    setImgGenerating(true);
    setImgGenProgress(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/images/generate-alt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(indices?.length ? { indices, page: currentPage } : { page: currentPage }),
      });
      if (!res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const eventLine = block.split("\n").find(l => l.startsWith("event:"));
          const dataLine = block.split("\n").find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim());

          if (event === "start") {
            setImgGenProgress({ done: 0, total: payload.total });
          } else if (event === "alt") {
            setImgGeneratingIndex(payload.index);
            if (!payload.skipped && payload.alt) {
              setImgList(prev => prev.map(img =>
                img.index === payload.index ? { ...img, alt: payload.alt } : img
              ));
            }
            setImgGenProgress(prev => prev ? { ...prev, done: prev.done + 1 } : null);
          } else if (event === "done") {
            setImgGenProgress(prev => prev ? { ...prev, done: prev.total } : null);
            setImgGeneratingIndex(null);
          }
        }
      }
    } finally {
      setImgGenerating(false);
      setImgGeneratingIndex(null);
    }
  }

  async function saveImages() {
    setImgSaving(true);
    try {
      const updates = imgList.map(({ index, alt }) => ({ index, alt }));
      const res = await fetch(`/api/sites/${siteId}/images`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates, sha: imgSha, page: currentPage }),
      });
      const data = await res.json();
      if (data.conflict) { setConflictError(data.error); return; }
      if (data.sha) setImgSha(data.sha);
      setImgSaved(true);
      setTimeout(() => setImgSaved(false), 2500);
    } finally { setImgSaving(false); }
  }

  async function runGenerateLocations() {
    if (!locCity.trim() || !locState.trim()) return;
    setLocRunning(true);
    setLocDone(false);
    setLocLog([]);

    try {
      const res = await fetch(`/api/sites/${siteId}/generate-locations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ city: locCity.trim(), state: locState.trim().toUpperCase(), count: parseInt(locCount, 10) || 50 }),
      });

      if (!res.body) throw new Error("No stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split("\n\n");
        buf = blocks.pop() ?? "";
        for (const block of blocks) {
          const lines = block.split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"));
          const dataLine = lines.find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;
          const event = eventLine.replace("event:", "").trim();
          const payload = JSON.parse(dataLine.replace("data:", "").trim());

          if (event === "progress") {
            setLocLog(prev => [...prev, { type: "progress", text: payload.message }]);
          } else if (event === "page") {
            const icon = payload.status === "ok" ? "✅" : "❌";
            setLocLog(prev => [...prev, { type: "page", text: `${icon} [${payload.index}/${payload.total}] ${payload.city}`, status: payload.status }]);
          } else if (event === "done") {
            setLocLog(prev => [...prev, { type: "done", text: `✨ Done — ${payload.pushed} pages generated${payload.failed > 0 ? `, ${payload.failed} failed` : ""}` }]);
            setLocDone(true);
            // Refresh locations list
            fetchLocations();
          } else if (event === "error") {
            setLocLog(prev => [...prev, { type: "error", text: `💥 ${payload.message}` }]);
            setLocDone(true);
          }
        }
      }
    } catch (err) {
      setLocLog(prev => [...prev, { type: "error", text: `Error: ${(err as Error).message}` }]);
      setLocDone(true);
    } finally {
      setLocRunning(false);
    }
  }

  async function fetchLocations() {
    if (locationsLoading) return;
    setLocationsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/locations`);
      if (res.ok) {
        const data = await res.json();
        setLocations(data.locations ?? []);
        setLocationsMeta({ indexUrl: data.indexUrl, total: data.total });
      }
    } catch { /* ignore */ } finally {
      setLocationsLoading(false);
    }
  }

  async function fetchVersions() {
    setVersionsLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/versions?page=${currentPage}`);
      const data = await res.json();
      setVersions(data.versions ?? []);
    } finally {
      setVersionsLoading(false);
    }
  }

  async function handleRollback(sha: string) {
    setRollingBack(sha);
    try {
      const res = await fetch(`/api/sites/${siteId}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sha, page: currentPage }),
      });
      const data = await res.json();
      if (data.commitSha) {
        pollDeployStatus(data.commitSha);
        await fetchVersions();
        await fetchSite();
      }
    } finally {
      setRollingBack(null);
    }
  }

  function applyFont(family: string, linkHref: string) {
    setCurrentFont(family);
    // Send font down to iframe
    iframeRef.current?.contentWindow?.postMessage(
      { type: "PIXEL_APPLY_FONT", fontFamily: family, linkHref },
      "*"
    );
  }

  // Rebuild blob when structural text changes (tag/list conversion) are pending
  useEffect(() => {
    if (!pendingRebuildRef.current) return;
    const html = localPages[currentPage];
    if (!html) return;
    pendingRebuildRef.current = false;
    revokeBlobUrl();
    const preview = buildBlobPreview(html, siteId, true);
    setBlobUrl(URL.createObjectURL(new Blob([preview], { type: "text/html" })));
    setPreviewKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPages]);

  // Load existing custom domains on mount
  async function fetchDomains() {
    const res = await fetch(`/api/sites/${siteId}/domain`);
    const data = await res.json();
    if (data.domains?.length > 0) {
      const d = data.domains[0];
      setActiveDomain(d.name);
      setDomainStatus(d.status === "active" ? "active" : "pending");
      if (d.status !== "active") {
        setCnameTarget(d.verification_data?.cname_target ?? `${siteId}.pages.dev`);
        startDomainPolling(d.name);
      }
    }
  }

  function startDomainPolling(domain: string) {
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    domainPollRef.current = setInterval(async () => {
      const res = await fetch(`/api/sites/${siteId}/domain`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      if (data.status === "active") {
        clearInterval(domainPollRef.current!);
        domainPollRef.current = null;
        setDomainStatus("active");
        setCnameTarget(null);
        await fetchSite();
      }
    }, 15000);
  }

  async function handleAddDomain() {
    if (!domainInput.trim()) return;
    setDomainStatus("adding");
    setDomainError(null);
    const res = await fetch(`/api/sites/${siteId}/domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: domainInput.trim() }),
    });
    const data = await res.json();
    if (data.error) {
      setDomainError(data.error);
      setDomainStatus("error");
      return;
    }
    const d = data.domain;
    setActiveDomain(d.name);
    if (d.status === "active") {
      setDomainStatus("active");
      await fetchSite();
    } else {
      setDomainStatus("pending");
      // CF Pages returns the project URL as the CNAME target
      setCnameTarget(d.verification_data?.cname_target ?? `${siteId}.pages.dev`);
      startDomainPolling(d.name);
    }
    setDomainInput("");
  }

  async function handleRemoveDomain() {
    if (!activeDomain) return;
    setRemovingDomain(true);
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    await fetch(`/api/sites/${siteId}/domain`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: activeDomain }),
    });
    setActiveDomain(null);
    setDomainStatus("idle");
    setCnameTarget(null);
    setRemovingDomain(false);
    await fetchSite();
  }

  useEffect(() => {
    return () => { if (domainPollRef.current) clearInterval(domainPollRef.current); };
  }, []);

  useEffect(() => {
    fetchSite();
    fetchVersions();
    fetchPages();
    fetchDomains();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  // Undo/Redo keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      const stack = undoStacks[currentPage] ?? [];
      const rstack = redoStacks[currentPage] ?? [];
      const cur = localPages[currentPage] ?? null;

      if (e.key === "z" && !e.shiftKey) {
        if (!stack.length) return;
        e.preventDefault();
        const prevHtmls = [...stack];
        const restoreHtml = prevHtmls.pop()!;
        setUndoStacks(prev => ({ ...prev, [currentPage]: prevHtmls }));
        if (cur) setRedoStacks(prev => ({ ...prev, [currentPage]: [...(prev[currentPage] ?? []), cur] }));
        setLocalPages(prev => ({ ...prev, [currentPage]: restoreHtml }));
        setDirtyPages(prev => new Set([...prev, currentPage]));
        revokeBlobUrl();
        const preview = buildBlobPreview(restoreHtml, siteId, true);
        setBlobUrl(URL.createObjectURL(new Blob([preview], { type: "text/html" })));
        setPreviewKey(k => k + 1);
        setRightTab("preview");

      } else if (e.key === "z" && e.shiftKey) {
        if (!rstack.length) return;
        e.preventDefault();
        const prevHtmls = [...rstack];
        const restoreHtml = prevHtmls.pop()!;
        setRedoStacks(prev => ({ ...prev, [currentPage]: prevHtmls }));
        if (cur) setUndoStacks(prev => ({ ...prev, [currentPage]: [...(prev[currentPage] ?? []), cur] }));
        setLocalPages(prev => ({ ...prev, [currentPage]: restoreHtml }));
        setDirtyPages(prev => new Set([...prev, currentPage]));
        revokeBlobUrl();
        const preview = buildBlobPreview(restoreHtml, siteId, true);
        setBlobUrl(URL.createObjectURL(new Blob([preview], { type: "text/html" })));
        setPreviewKey(k => k + 1);
        setRightTab("preview");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPages, undoStacks, redoStacks, currentPage, siteId]);

  // Warn before closing with unsaved edits
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtyCount > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  // postMessage listener for interactive preview image clicks
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type === "PIXEL_IMG_CLICK") {
        setSelectedImg({
          index: e.data.index,
          rawSrc: e.data.rawSrc ?? "",
          resolvedSrc: e.data.resolvedSrc ?? e.data.rawSrc ?? "",
          kind: e.data.kind ?? "img",
        });
        setImgReplaceFile(null);
        setImgReplaceError("");
        setImgReplaceSuccess(false);
      } else if (e.data?.type === "PIXEL_DESELECT") {
        setSelectedImg(null);
      } else if (e.data?.type === "PIXEL_TEXT_START") {
        setTextEditing(true);
        setSelectedImg(null); // close image panel if open
      } else if (e.data?.type === "PIXEL_TEXT_END") {
        setTextEditing(false);
        setShowFontPicker(false);
      } else if (e.data?.type === "PIXEL_OPEN_FONT_PICKER") {
        setShowFontPicker(prev => !prev); // toggle
      } else if (e.data?.type === "PIXEL_FONT_LINK") {
        // Inject the Google Fonts <link> into <head> of localHtml so it persists on deploy
        const { linkHref } = e.data as { linkHref: string };
        if (!linkHref) return;
        setLocalPages(prev => {
          const current = prev[currentPage];
          if (!current) return prev;
          // Skip if already present
          if (current.includes(linkHref)) return prev;
          // Remove any previous pixel font link for the same family
          const stripped = current.replace(/<link[^>]+data-pixel-font[^>]+>/g, "");
          const tag = `<link rel="stylesheet" href="${linkHref}" data-pixel-font="true">`;
          const updated = stripped.includes("</head>")
            ? stripped.replace("</head>", `${tag}\n</head>`)
            : tag + stripped;
          return { ...prev, [currentPage]: updated };
        });
      } else if (e.data?.type === "PIXEL_TEXT_CHANGE") {
        const { originalHtml, newHtml, needsRebuild } = e.data as { originalHtml: string; newHtml: string; needsRebuild?: boolean };
        setLocalPages(prev => {
          const current = prev[currentPage];
          if (!current || !current.includes(originalHtml)) return prev;
          const updated = current.split(originalHtml).join(newHtml);
          setUndoStacks(u => ({ ...u, [currentPage]: [...(u[currentPage] ?? []), current] }));
          setRedoStacks(r => ({ ...r, [currentPage]: [] }));
          setDirtyPages(d => new Set([...d, currentPage]));
          if (needsRebuild) pendingRebuildRef.current = true;
          return { ...prev, [currentPage]: updated };
        });
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Re-fetch chat history when page changes (chat is scoped per page)
  useEffect(() => {
    if (!siteId) return;
    fetch(`/api/sites/${siteId}?page=${currentPage}`)
      .then(r => r.json())
      .then(d => { if (d.chatMessages) setChatMessages(d.chatMessages); })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function handleSave() {
    if (!site) return;
    setSaving(true);
    const res = await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(site),
    });
    const data = await res.json();
    if (data.html) {
      revokeBlobUrl();
      const preview = buildBlobPreview(data.html, siteId, true);
      const blob = new Blob([preview], { type: "text/html" });
      setBlobUrl(URL.createObjectURL(blob));
      setRightTab("preview");
      setPreviewKey((k) => k + 1);
    }
    await fetchSite();
    setSaving(false);
  }

  async function handleDeploy(type: "preview" | "production") {
    setHtmlDeploying(true);
    const res = await fetch("/api/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, type }),
    });
    const data = await res.json();
    if (data.url) {
      await fetchSite();
    }
    setHtmlDeploying(false);
    if (data.commitSha) {
      pollDeployStatus(data.commitSha);
    }
  }

  async function handleChatSend() {
    if (!chatInput.trim() || chatLoading) return;
    const message = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: message }]);
    setChatLoading(true);

    const res = await fetch("/api/ai-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        siteId,
        message,
        chatHistory: chatMessages,
        page: currentPage,
      }),
    });

    const data = await res.json();
    if (data.changes) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.changes },
      ]);
      if (data.html) {
        // Push current state to undo stack before applying new edit
        if (localHtml) pushUndo(currentPage, localHtml);
        setRedoStacks(prev => ({ ...prev, [currentPage]: [] }));
        setPageHtml(currentPage, data.html);
        markDirty(currentPage);
        // Update blob preview
        revokeBlobUrl();
        const preview = buildBlobPreview(data.html, siteId, true);
        const blob = new Blob([preview], { type: "text/html" });
        setBlobUrl(URL.createObjectURL(blob));
        setRightTab("preview");
        setPreviewKey((k) => k + 1);
      }
    } else if (data.conflict) {
      setConflictError(data.error);
    } else if (data.error) {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Error: ${data.error}` },
      ]);
    }
    setChatLoading(false);
  }

  async function handleArchive() {
    setArchiving(true);
    await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    router.push("/dashboard");
  }

  async function handleUpload() {
    if (!uploadFile) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);

    const fd = new FormData();
    fd.append("file", uploadFile);

    try {
      const res = await fetch(`/api/sites/${siteId}/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        setUploadError(data.error || "Upload failed");
      } else {
        setUploadResult({ filename: data.filename, url: data.url });
        setUploadFile(null);
      }
    } catch {
      setUploadError("Upload failed — check your connection");
    }
    setUploading(false);
  }

  if (!site) {
    return (
      <div className="p-8">
        <p className="text-gray-500 text-sm">Loading site...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Main content: left sidebar + right panel */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Site Details / SEO / Images */}
        <div className="w-72 shrink-0 h-full flex flex-col overflow-hidden border-r border-gray-200 bg-white min-w-0">

          {/* Tab bar */}
          <div className="flex shrink-0 border-b border-gray-200 bg-gray-50">
            {(["details", "seo", "images"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setLeftTab(tab);
                  if (tab === "seo" && !seoData) fetchSeo();
                  if (tab === "images" && imgList.length === 0) fetchImages();
                }}
                className={`flex-1 py-2.5 text-[11px] font-semibold uppercase tracking-wider transition-colors border-b-2 ${
                  leftTab === tab
                    ? "text-zing-teal border-zing-teal bg-white"
                    : "text-gray-400 border-transparent hover:text-gray-600"
                }`}
              >
                {tab === "details" ? "Details" : tab === "seo" ? "SEO" : "Images"}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 min-w-0">

          {/* ── DETAILS TAB ── */}
          {leftTab === "details" && (<>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-zing-dark">Site Details</h2>
            <button
              onClick={handleExtract}
              disabled={extracting}
              title="Pull current values from the live website HTML"
              className="text-xs text-zing-teal hover:text-zing-dark disabled:opacity-50 flex items-center gap-1 transition-colors"
            >
              {extracting ? (
                <span>Reading...</span>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Sync from site
                </>
              )}
            </button>
          </div>

          <div className="space-y-2.5">
            <Field
              label="Business Name"
              value={site.business_name}
              onChange={(v) => setSite({ ...site, business_name: v })}
            />
            <Field
              label="Phone"
              value={site.phone ?? ""}
              onChange={(v) => setSite({ ...site, phone: v })}
            />
            <Field
              label="Contact Email"
              value={site.email ?? ""}
              onChange={(v) => setSite({ ...site, email: v })}
            />
            <Field
              label="Form Routing Email"
              value={site.owner_email ?? ""}
              onChange={(v) => setSite({ ...site, owner_email: v })}
              helpText="Contact form submissions go here"
            />
            <Field
              label="Address"
              value={site.address ?? ""}
              onChange={(v) => setSite({ ...site, address: v })}
            />
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
                Hours
              </label>
              <textarea
                value={site.hours ?? ""}
                rows={2}
                onChange={(e) => { setSite({ ...site, hours: e.target.value }); autoGrow(e.target); }}
                ref={el => autoGrow(el)}
                className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal bg-gray-50 focus:bg-white transition-colors resize-none overflow-hidden leading-snug"
              />
            </div>
            <Field
              label="Hero Headline"
              value={site.hero_headline ?? ""}
              onChange={(v) => setSite({ ...site, hero_headline: v })}
            />
            <Field
              label="Hero Subheadline"
              value={site.hero_subheadline ?? ""}
              onChange={(v) => setSite({ ...site, hero_subheadline: v })}
            />
            <Field
              label="CTA Button Text"
              value={site.cta_text ?? ""}
              onChange={(v) => setSite({ ...site, cta_text: v })}
            />
          </div>

          {/* Images Upload */}
          <div className="mt-6">
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Images
            </label>
            <div className="flex gap-2">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  setUploadFile(e.target.files?.[0] ?? null);
                  setUploadResult(null);
                  setUploadError(null);
                }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
              />
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50 whitespace-nowrap"
              >
                {uploading ? "Uploading..." : "Upload Image"}
              </button>
            </div>
            {uploadResult && (
              <div className="mt-2 bg-green-50 border border-green-200 rounded-md px-3 py-2 text-sm text-green-800">
                <span>&#x2705; {uploadResult.filename} uploaded &mdash; </span>
                <button
                  onClick={() => navigator.clipboard.writeText(uploadResult.url)}
                  className="underline font-medium hover:text-green-900"
                >
                  copy URL
                </button>
                <span className="text-xs text-green-600"> to use in the AI chat</span>
              </div>
            )}
            {uploadError && (
              <p className="mt-2 text-sm text-red-600">{uploadError}</p>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="mt-4 w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>

          {/* Go Live / Custom Domain */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Custom Domain
              </p>
              {domainStatus === "active" && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Live
                </span>
              )}
              {domainStatus === "pending" && (
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                  Pending DNS
                </span>
              )}
            </div>

            {activeDomain ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
                  <span className="text-sm font-medium text-zing-dark">{activeDomain}</span>
                  <button
                    onClick={handleRemoveDomain}
                    disabled={removingDomain}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {removingDomain ? "Removing..." : "Remove"}
                  </button>
                </div>

                {domainStatus === "pending" && cnameTarget && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs space-y-1.5">
                    <p className="font-medium text-amber-800">DNS setup required</p>
                    <p className="text-amber-700">Add this CNAME record at your domain registrar:</p>
                    <div className="font-mono bg-white border border-amber-200 rounded px-2 py-1.5 space-y-1">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Type</span>
                        <span className="font-semibold">CNAME</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Name</span>
                        <span className="font-semibold">@</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-gray-500 shrink-0">Target</span>
                        <button
                          onClick={() => navigator.clipboard.writeText(cnameTarget)}
                          className="font-semibold text-zing-teal hover:underline truncate"
                          title="Click to copy"
                        >
                          {cnameTarget}
                        </button>
                      </div>
                    </div>
                    <p className="text-amber-600">Checking every 15s — this page will update automatically once DNS propagates.</p>
                  </div>
                )}

                {domainStatus === "active" && site?.live_url && (
                  <a
                    href={site.live_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center text-xs text-zing-teal hover:underline"
                  >
                    Open live site ↗
                  </a>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddDomain()}
                    placeholder="e.g. mooreroofingfl.com"
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                  <button
                    onClick={handleAddDomain}
                    disabled={domainStatus === "adding" || !domainInput.trim()}
                    className="bg-green-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {domainStatus === "adding" ? "Adding..." : "Go Live"}
                  </button>
                </div>
                {domainError && (
                  <p className="text-xs text-red-600">{domainError}</p>
                )}
                <p className="text-xs text-gray-400">
                  Enter the customer&apos;s domain. SSL is provisioned automatically by Cloudflare.
                </p>
              </div>
            )}
          </div>

          {/* Archive section */}
          <div className="mt-6 pt-6 border-t border-gray-200">
            <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
              Danger Zone
            </p>
            <button
              onClick={() => setShowArchiveModal(true)}
              className="w-full text-center border border-gray-300 text-gray-500 px-3 py-2 rounded-md text-sm hover:bg-gray-50 transition-colors"
            >
              Archive Site
            </button>
          </div>
          </>)}

          {/* ── SEO TAB ── */}
          {leftTab === "seo" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zing-dark">SEO</h2>
                <button onClick={fetchSeo} disabled={seoLoading} className="text-xs text-zing-teal hover:text-zing-dark disabled:opacity-50">
                  {seoLoading ? "Loading..." : "↺ Refresh"}
                </button>
              </div>

              {seoLoading && <p className="text-xs text-gray-400">Loading...</p>}
              {!seoLoading && seoData && (<>
                {/* Title */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Page Title</label>
                    <span className={`text-[10px] ${seoData.title.length > 60 ? "text-red-400" : "text-gray-400"}`}>{seoData.title.length}/60</span>
                  </div>
                  <textarea
                    value={seoData.title}
                    rows={1}
                    onChange={e => { setSeoData({ ...seoData, title: e.target.value }); autoGrow(e.target); }}
                    ref={el => autoGrow(el)}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                  />
                </div>

                {/* Meta description */}
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Meta Description</label>
                    <span className={`text-[10px] ${seoData.description.length > 160 ? "text-red-400" : "text-gray-400"}`}>{seoData.description.length}/160</span>
                  </div>
                  <textarea
                    value={seoData.description}
                    rows={2}
                    onChange={e => { setSeoData({ ...seoData, description: e.target.value }); autoGrow(e.target); }}
                    ref={el => autoGrow(el)}
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                  />
                </div>

                {/* Canonical */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Canonical URL</label>
                  <textarea
                    value={seoData.canonical}
                    rows={1}
                    onChange={e => { setSeoData({ ...seoData, canonical: e.target.value }); autoGrow(e.target); }}
                    ref={el => autoGrow(el)}
                    placeholder="https://yourdomain.com/"
                    className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                  />
                </div>

                {/* H1 (read-only — edit in AI editor) */}
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">H1 <span className="text-gray-300 normal-case font-normal">(edit in AI Editor)</span></label>
                  <p className="text-sm text-gray-500 bg-gray-50 border border-gray-100 rounded px-2.5 py-1.5 break-words">{seoData.h1 || "—"}</p>
                </div>

                {/* OG */}
                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Open Graph (Social)</p>
                  <div className="space-y-2">
                    <textarea
                      value={seoData.ogTitle}
                      rows={1}
                      onChange={e => { setSeoData({ ...seoData, ogTitle: e.target.value }); autoGrow(e.target); }}
                      ref={el => autoGrow(el)}
                      placeholder="OG Title (defaults to page title)"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                    />
                    <textarea
                      value={seoData.ogDescription}
                      rows={2}
                      onChange={e => { setSeoData({ ...seoData, ogDescription: e.target.value }); autoGrow(e.target); }}
                      ref={el => autoGrow(el)}
                      placeholder="OG Description"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                    />
                    <textarea
                      value={seoData.ogImage}
                      rows={1}
                      onChange={e => { setSeoData({ ...seoData, ogImage: e.target.value }); autoGrow(e.target); }}
                      ref={el => autoGrow(el)}
                      placeholder="OG Image URL"
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal resize-none overflow-hidden leading-snug"
                    />
                  </div>
                </div>

                <button
                  onClick={saveSeo}
                  disabled={seoSaving}
                  className="w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
                >
                  {seoSaving ? "Saving..." : seoSaved ? "✓ Saved" : "Save SEO"}
                </button>
              </>)}
            </div>
          )}

          {/* ── IMAGES TAB ── */}
          {leftTab === "images" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-zing-dark">Image Alt Text</h2>
                <button onClick={fetchImages} disabled={imgLoading || imgGenerating} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">
                  {imgLoading ? "Loading..." : "↺"}
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-3">Alt text improves accessibility and image SEO.</p>

              {/* AI Generate All button */}
              {imgList.length > 0 && (
                <button
                  onClick={() => generateAltText()}
                  disabled={imgGenerating || imgLoading}
                  className="w-full mb-4 flex items-center justify-center gap-2 bg-zing-dark text-white px-4 py-2 rounded-md text-xs font-semibold hover:bg-black transition-colors disabled:opacity-50"
                >
                  {imgGenerating ? (
                    <>
                      <span className="animate-spin text-sm">⟳</span>
                      {imgGenProgress ? `${imgGenProgress.done}/${imgGenProgress.total} images...` : "Starting..."}
                    </>
                  ) : (
                    <><span>✨</span> AI Generate All</>
                  )}
                </button>
              )}

              {imgLoading && <p className="text-xs text-gray-400">Loading images...</p>}

              {!imgLoading && imgList.length === 0 && (
                <p className="text-xs text-gray-400">No images found.</p>
              )}

              {!imgLoading && imgList.length > 0 && (
                <div className="space-y-3">
                  {imgList.map((img) => {
                    const isGeneratingThis = imgGeneratingIndex === img.index;
                    return (
                    <div key={img.index} className={`bg-gray-50 border rounded-lg p-2.5 transition-colors ${isGeneratingThis ? "border-zing-teal/50 bg-zing-teal/5" : "border-gray-200"}`}>
                      <div className="flex gap-2.5 mb-2">
                        <img
                          src={img.previewUrl}
                          alt=""
                          className="w-12 h-12 object-cover rounded shrink-0 bg-gray-200"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-semibold text-gray-500 truncate">{img.context}</p>
                          <p className="text-[10px] text-gray-300 truncate">{img.src}</p>
                        </div>
                        {/* Per-image regenerate */}
                        <button
                          onClick={() => generateAltText([img.index])}
                          disabled={imgGenerating}
                          title="Regenerate with AI"
                          className="text-gray-300 hover:text-zing-teal disabled:opacity-30 transition-colors shrink-0 text-sm"
                        >
                          {isGeneratingThis ? <span className="animate-spin inline-block">⟳</span> : "✨"}
                        </button>
                      </div>
                      <input
                        value={img.alt}
                        onChange={e => setImgList(prev => prev.map(i => i.index === img.index ? { ...i, alt: e.target.value } : i))}
                        placeholder={isGeneratingThis ? "Generating..." : "Describe this image..."}
                        disabled={isGeneratingThis}
                        className={`w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-zing-teal disabled:bg-gray-50 disabled:text-gray-400 transition-colors ${img.alt ? "text-gray-800" : "text-gray-400"}`}
                      />
                    </div>
                    );
                  })}

                  <button
                    onClick={saveImages}
                    disabled={imgSaving}
                    className="w-full bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
                  >
                    {imgSaving ? "Saving..." : imgSaved ? "✓ Saved" : `Save Alt Text (${imgList.length} images)`}
                  </button>
                </div>
              )}
            </div>
          )}

          </div>{/* end scrollable content */}
        </div>{/* end left sidebar */}

        {/* Divider */}
        <div className="w-px bg-gray-200 shrink-0" />

        {/* Right: Tabbed Chat / Preview */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

          {/* Page selector bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 border-b border-gray-200 overflow-x-auto shrink-0">
            {pages.map((p) => (
              <button
                key={p.filename}
                onClick={() => {
                  setCurrentPage(p.filename);
                  setBlobUrl(null);
                  setLocationPreview(null);
                  setSeoData(null);
                  setImgList([]);
                  setChatMessages([]);
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors group ${
                  currentPage === p.filename
                    ? "bg-white text-zing-teal shadow-sm border border-gray-200"
                    : "text-gray-500 hover:text-gray-700 hover:bg-white/70"
                }`}
              >
                {p.isHome && <span className="text-[10px]">🏠</span>}
                {p.label}
                {dirtyPages.has(p.filename) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved edits" />
                )}
                {!p.isHome && currentPage === p.filename && (
                  <span
                    onClick={(e) => { e.stopPropagation(); deletePage(p.filename); }}
                    className="ml-1 text-gray-300 hover:text-red-400 transition-colors cursor-pointer text-[10px] leading-none"
                    title={`Delete ${p.filename}`}
                  >✕</span>
                )}
              </button>
            ))}
            {/* New page button */}
            <button
              onClick={() => setShowNewPageModal(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-medium text-gray-400 hover:text-zing-teal hover:bg-white/70 transition-colors whitespace-nowrap ml-1"
            >
              <span className="text-sm leading-none">+</span> New Page
            </button>
          </div>

          {/* Tab bar */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-white pr-4">
            <div className="flex">
              <button
                onClick={() => setRightTab("chat")}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === "chat"
                    ? "border-zing-teal text-zing-teal"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                AI Editor
              </button>
              <button
                onClick={() => {
                  setRightTab("preview");
                  setLocationPreview(null);
                  // Always load interactive blob preview for same-origin postMessage support
                  if (!blobUrl) loadInteractivePreview();
                }}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === "preview"
                    ? "border-zing-teal text-zing-teal"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                Preview
              </button>
              <button
                onClick={() => { setRightTab("analytics"); fetchAnalytics(); }}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
                  rightTab === "analytics"
                    ? "border-zing-teal text-zing-teal"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                Analytics
              </button>
            </div>

            {/* Device toggle — only when on Preview tab */}
            {rightTab === "preview" && (
              <div className="flex items-center gap-0.5 bg-gray-100 rounded-md p-0.5">
                {(["desktop", "tablet", "mobile"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDeviceView(d)}
                    title={d.charAt(0).toUpperCase() + d.slice(1)}
                    className={`px-2 py-1 rounded text-gray-500 transition-colors ${
                      deviceView === d
                        ? "bg-white shadow-sm text-zing-dark"
                        : "hover:text-gray-700"
                    }`}
                  >
                    {d === "desktop" && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="2" y="3" width="20" height="14" rx="2" strokeWidth="2" strokeLinecap="round"/>
                        <path d="M8 21h8M12 17v4" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                    )}
                    {d === "tablet" && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="4" y="2" width="16" height="20" rx="2" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="18" r="1" fill="currentColor"/>
                      </svg>
                    )}
                    {d === "mobile" && (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <rect x="7" y="2" width="10" height="20" rx="2" strokeWidth="2" strokeLinecap="round"/>
                        <circle cx="12" cy="18" r="1" fill="currentColor"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Chat panel */}
          {rightTab === "chat" && (
            <>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {chatMessages.length === 0 && (
                  <p className="text-sm text-gray-400 text-center mt-8">
                    No messages yet. Describe a change to get started.
                  </p>
                )}
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] px-3 py-2 rounded-lg text-sm ${
                        msg.role === "user"
                          ? "bg-zing-teal text-white"
                          : "bg-white border border-gray-200 text-gray-800"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 px-3 py-2 rounded-lg text-sm text-gray-500">
                      Pixel is editing...
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="px-4 py-3 border-t border-gray-200 bg-white">
                <div className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleChatSend()}
                    placeholder="Describe a change..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal bg-gray-50 focus:bg-white transition-colors"
                  />
                  <button
                    onClick={handleChatSend}
                    disabled={chatLoading || !chatInput.trim()}
                    className="bg-zing-teal text-white px-4 py-2 rounded text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50 shrink-0"
                  >
                    {chatLoading ? "..." : "Send"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Preview panel */}
          {rightTab === "preview" && (
            <div className="flex-1 flex flex-col">
              {site.preview_url ? (
                <>
                  <div className="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200">
                    <div className="flex items-center gap-2 min-w-0">
                      {textEditing ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 text-xs bg-zing-teal/10 text-zing-teal px-2 py-0.5 rounded-full font-medium whitespace-nowrap animate-pulse">
                            ✏️ Editing — click away to save
                          </span>
                          {/* Font picker trigger */}
                          <div className="relative">
                            <button
                              onClick={() => setShowFontPicker(p => !p)}
                              className={`text-xs px-2 py-0.5 rounded-full font-semibold border transition-colors ${
                                showFontPicker
                                  ? "bg-zing-teal text-white border-zing-teal"
                                  : "border-gray-300 text-gray-600 hover:border-zing-teal hover:text-zing-teal"
                              }`}
                            >
                              Aa {currentFont ? `· ${currentFont}` : ""}
                            </button>
                            {showFontPicker && (
                              <FontPicker
                                currentFont={currentFont}
                                onSelect={applyFont}
                                onClose={() => setShowFontPicker(false)}
                              />
                            )}
                          </div>
                        </div>
                      ) : blobUrl ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          ⚡ Unsaved preview
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">
                          ✓ Deployed
                        </span>
                      )}
                      <span className="text-xs text-gray-400 truncate">
                        {blobUrl ? "Changes not yet deployed to Cloudflare" : site.preview_url}
                      </span>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {blobUrl && (
                        <button
                          onClick={revokeBlobUrl}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                          title="Switch back to the deployed version"
                        >
                          Show deployed
                        </button>
                      )}
                      <button
                        onClick={() => setPreviewKey((k) => k + 1)}
                        className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100"
                      >
                        ↻ Refresh
                      </button>
                      {!blobUrl && site.preview_url && (
                        <a
                          href={site.preview_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-zing-teal hover:underline px-2 py-1"
                        >
                          Open ↗
                        </a>
                      )}
                    </div>
                  </div>
                  {/* Device frame + iframe */}
                  <div className="flex-1 overflow-auto bg-gray-100 flex items-start justify-center relative">
                    {/* Image replace overlay */}
                    {selectedImg && (
                      <div className="absolute bottom-4 right-4 z-20 bg-white rounded-xl shadow-2xl border border-gray-200 w-72 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                          <div>
                            <p className="text-xs font-semibold text-zing-dark">Replace {selectedImg.kind === "bg" ? "Background" : "Image"}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5 truncate max-w-[180px]">{selectedImg.rawSrc}</p>
                          </div>
                          <button onClick={() => setSelectedImg(null)} className="text-gray-400 hover:text-gray-600 text-sm leading-none ml-2 shrink-0">✕</button>
                        </div>

                        {/* Current image preview */}
                        <div className="px-4 pt-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedImg.resolvedSrc}
                            alt="Current image"
                            className="w-full h-28 object-cover rounded-lg border border-gray-100 bg-gray-50"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                          />
                        </div>

                        <div className="px-4 pb-4 pt-3 space-y-2">
                          <label className="block">
                            <input
                              ref={imgReplaceInputRef}
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                              onChange={e => setImgReplaceFile(e.target.files?.[0] ?? null)}
                              className="hidden"
                            />
                            <button
                              onClick={() => imgReplaceInputRef.current?.click()}
                              className="w-full px-3 py-2 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-500 hover:border-zing-teal hover:text-zing-teal transition-colors text-center"
                            >
                              {imgReplaceFile ? `✓ ${imgReplaceFile.name}` : "Choose replacement image"}
                            </button>
                          </label>

                          {imgReplaceError && <p className="text-[11px] text-red-500">{imgReplaceError}</p>}

                          <button
                            onClick={handleImageReplace}
                            disabled={!imgReplaceFile || imgReplacing}
                            className="w-full bg-zing-teal text-white px-3 py-2 rounded-lg text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                          >
                            {imgReplacing
                              ? <><span className="animate-spin">⟳</span> Uploading...</>
                              : imgReplaceSuccess
                                ? "✓ Replaced!"
                                : "Upload & Replace"
                            }
                          </button>
                          <p className="text-[10px] text-gray-400 text-center">Saves to GitHub and triggers a deploy</p>
                        </div>
                      </div>
                    )}

                    {deviceView === "desktop" ? (
                      <iframe
                        ref={iframeRef}
                        key={`${previewKey}-desktop-${locationPreview ?? ""}`}
                        src={locationPreview ?? blobUrl ?? site.preview_url ?? ""}
                        className="w-full h-full border-0 bg-white"
                        style={{ minHeight: "100%" }}
                        title="Site Preview"
                      />
                    ) : (
                      <div
                        className="my-4 shrink-0 relative"
                        style={{
                          width: deviceView === "tablet" ? 768 : 375,
                        }}
                      >
                        {/* Device chrome */}
                        <div
                          className={`rounded-2xl overflow-hidden shadow-xl border-4 ${
                            deviceView === "tablet"
                              ? "border-gray-700 rounded-2xl"
                              : "border-gray-800 rounded-3xl"
                          }`}
                        >
                          {/* Status bar strip */}
                          <div className="bg-gray-800 h-6 flex items-center justify-center">
                            <div className={`bg-gray-600 rounded-full ${
                              deviceView === "tablet" ? "w-12 h-1" : "w-20 h-1.5"
                            }`} />
                          </div>
                          <iframe
                            key={`${previewKey}-${deviceView}`}
                            src={blobUrl ?? site.preview_url ?? ""}
                            className="block border-0 bg-white"
                            style={{
                              width: deviceView === "tablet" ? 760 : 367,
                              height: deviceView === "tablet" ? 960 : 700,
                            }}
                            title="Site Preview"
                          />
                          {/* Home bar */}
                          <div className="bg-gray-800 h-6 flex items-center justify-center">
                            <div className="bg-gray-600 rounded-full w-16 h-1" />
                          </div>
                        </div>
                        {/* Size label */}
                        <p className="text-center text-xs text-gray-400 mt-2">
                          {deviceView === "tablet" ? "768px — Tablet" : "375px — Mobile"}
                        </p>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-gray-400">
                    No preview URL yet. Click Deploy Preview to generate one.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Analytics panel */}
          {rightTab === "analytics" && (
            <div className="flex-1 overflow-y-auto bg-gray-50 p-5">
              {analyticsLoading ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-gray-400">Loading analytics...</p>
                </div>
              ) : !analyticsData ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-sm text-gray-400">No analytics data yet.</p>
                </div>
              ) : (
                <div className="space-y-4 max-w-2xl">
                  {/* Headline stats */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Page Views (30d)</p>
                      <p className="text-2xl font-bold text-zing-dark">{analyticsData.pageviews.toLocaleString()}</p>
                    </div>
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Visits (30d)</p>
                      <p className="text-2xl font-bold text-zing-dark">{analyticsData.visits.toLocaleString()}</p>
                    </div>
                  </div>

                  {/* Daily sparkline */}
                  {analyticsData.daily.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Daily Page Views</p>
                      <div className="flex items-end gap-0.5 h-20">
                        {(() => {
                          const max = Math.max(...analyticsData.daily.map((d) => d.pageviews), 1);
                          return analyticsData.daily.map((d) => (
                            <div
                              key={d.date}
                              className="flex-1 bg-zing-teal/70 rounded-sm hover:bg-zing-teal transition-colors"
                              style={{ height: `${Math.max(4, (d.pageviews / max) * 100)}%` }}
                              title={`${d.date}: ${d.pageviews} views`}
                            />
                          ));
                        })()}
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-gray-400">{analyticsData.daily[0]?.date}</span>
                        <span className="text-[10px] text-gray-400">{analyticsData.daily[analyticsData.daily.length - 1]?.date}</span>
                      </div>
                    </div>
                  )}

                  {/* Countries + Referrers side by side */}
                  <div className="grid grid-cols-2 gap-3">
                    {analyticsData.countries.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Top Countries</p>
                        <div className="space-y-1.5">
                          {analyticsData.countries.map((c) => (
                            <div key={c.name} className="flex justify-between text-xs">
                              <span className="text-gray-700 truncate">{c.name}</span>
                              <span className="text-gray-500 font-medium shrink-0 ml-2">{c.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {analyticsData.referrers.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-4">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Top Referrers</p>
                        <div className="space-y-1.5">
                          {analyticsData.referrers.map((r) => (
                            <div key={r.host} className="flex justify-between text-xs">
                              <span className="text-gray-700 truncate">{r.host || "Direct"}</span>
                              <span className="text-gray-500 font-medium shrink-0 ml-2">{r.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Devices */}
                  {analyticsData.devices.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-4">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Devices</p>
                      <div className="flex gap-4">
                        {analyticsData.devices.map((d) => {
                          const total = analyticsData.devices.reduce((s, x) => s + x.count, 0);
                          return (
                            <div key={d.type} className="flex items-center gap-1.5 text-xs">
                              <span className="capitalize text-gray-700 font-medium">{d.type || "other"}</span>
                              <span className="text-gray-400">{total > 0 ? Math.round((d.count / total) * 100) : 0}%</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-gray-400">
                    Data from Cloudflare Analytics · {analyticsData.pageviews === 0 ? "No traffic yet — analytics will appear once visitors arrive." : "Last 30 days"}
                  </p>
                </div>
              )}
            </div>
          )}

      {/* Bottom bar */}
      <div className="border-t border-gray-200 bg-white px-5 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {site.preview_url ? (
            <a
              href={site.preview_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zing-teal hover:underline truncate max-w-[220px]"
            >
              {site.preview_url}
            </a>
          ) : (
            <span className="text-xs text-gray-400">No preview yet</span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Deploy status badge */}
          {deployState === "queued" && (
            <span className="text-xs text-amber-600 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              Queued...
            </span>
          )}
          {deployState === "in_progress" && (
            <span className="text-xs text-blue-600 flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
              Deploying to Cloudflare...
            </span>
          )}
          {deployState === "success" && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              ✅ Deploy complete
            </span>
          )}
          {deployState === "failure" && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              ❌ Deploy failed
            </span>
          )}
          {deploying && deployState === "idle" && (
            <span className="text-xs text-gray-500">Committing...</span>
          )}

          {/* Unsaved edits indicator */}
          {dirtyCount > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              {dirtyCount === 1 ? "1 page unsaved" : `${dirtyCount} pages unsaved`}
              {undoStack.length > 0 && isDirty && (
                <span className="text-gray-400 font-normal ml-0.5">· {undoStack.length} undo{undoStack.length !== 1 ? "s" : ""}</span>
              )}
            </span>
          )}

          {/* Deploy This Page */}
          <button
            onClick={deployLocalHtml}
            disabled={!isDirty || htmlDeploying || deployState === "in_progress" || deployState === "queued"}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors disabled:opacity-40 ${
              isDirty
                ? "bg-zing-teal text-white hover:bg-zing-dark"
                : "bg-gray-100 text-gray-400 cursor-default"
            }`}
          >
            {htmlDeploying && isDirty ? "Saving..." : "Deploy This Page"}
          </button>

          {/* Deploy All — only shown when multiple pages are dirty */}
          {dirtyCount > 1 && (
            <button
              onClick={deployAllPages}
              disabled={htmlDeploying || deployState === "in_progress" || deployState === "queued"}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-zing-dark text-white hover:bg-zing-teal transition-colors disabled:opacity-40"
            >
              {htmlDeploying ? "Deploying..." : `Deploy All (${dirtyCount})`}
            </button>
          )}
          {currentPage === "index.html" && (
            <button
              onClick={() => setShowLocModal(true)}
              className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-xs font-medium hover:bg-gray-200 transition-colors flex items-center gap-1.5"
            >
              📍 Generate Locations
            </button>
          )}
        </div>
        </div>
        </div>
      </div>

      {/* Bottom panel: Deployments / Activity / Versions / Locations */}
      <div className="h-48 shrink-0 flex flex-col bg-white border-t border-gray-200">
        <div className="flex gap-0.5 px-5 border-b border-gray-200">
          {(["deployments", "activity", "versions", "locations"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setBottomTab(tab);
                if (tab === "versions") fetchVersions();
                if (tab === "locations") fetchLocations();
              }}
              className={`px-3 py-2.5 text-[11px] font-medium capitalize transition-colors flex items-center gap-1.5 ${
                bottomTab === tab
                  ? "text-zing-teal border-b-2 border-zing-teal"
                  : "text-gray-400 hover:text-gray-600 border-b-2 border-transparent"
              }`}
            >
              {tab}
              {tab === "deployments" && deployments.length > 0 && (
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${bottomTab === "deployments" ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"}`}>{deployments.length}</span>
              )}
              {tab === "activity" && editLog.length > 0 && (
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${bottomTab === "activity" ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"}`}>{editLog.length}</span>
              )}
              {tab === "locations" && locations.length > 0 && (
                <span className={`text-[10px] font-semibold rounded-full px-1.5 py-0.5 ${bottomTab === "locations" ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"}`}>{locations.length}</span>
              )}

            </button>
          ))}
        </div>

        <div className="px-5 py-2.5 flex-1 overflow-y-auto text-xs">
          {bottomTab === "deployments" && (
            deployments.length === 0 ? (
              <p className="text-xs text-gray-400">No deployments yet.</p>
            ) : (
              <div className="space-y-1.5">
                {deployments.map((dep) => (
                  <div key={dep.id} className="flex items-center gap-3 text-xs text-gray-500">
                    <span className={`font-medium w-20 shrink-0 ${
                      dep.type === "production" ? "text-green-600" : dep.type === "rollback" ? "text-purple-600" : "text-amber-600"
                    }`}>
                      {dep.type}
                    </span>
                    {dep.url && (
                      <a href={dep.url} target="_blank" rel="noopener noreferrer"
                        className="text-zing-teal hover:underline truncate max-w-xs">
                        {dep.url}
                      </a>
                    )}
                    <span className="shrink-0">
                      {new Date(dep.deployed_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {dep.deployed_by && (
                      <span className="text-gray-400 shrink-0">by {dep.deployed_by.split("@")[0]}</span>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {bottomTab === "activity" && (
            editLog.length === 0 ? (
              <p className="text-xs text-gray-400">No edit activity yet.</p>
            ) : (
              <div className="space-y-1.5">
                {editLog.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3 text-xs text-gray-500">
                    <span className={`font-medium shrink-0 ${
                      entry.action === "ai_edit" ? "text-zing-teal" : "text-gray-600"
                    }`}>
                      {entry.action === "ai_edit" ? "AI" : "Field"}
                    </span>
                    <span className="flex-1 truncate" title={entry.summary}>{entry.summary}</span>
                    <span className="shrink-0 text-gray-400">
                      {new Date(entry.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {entry.user_email && (
                      <span className="text-gray-400 shrink-0">
                        {entry.user_email.split("@")[0]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {bottomTab === "versions" && (
            versionsLoading ? (
              <p className="text-xs text-gray-400">Loading...</p>
            ) : versions.length === 0 ? (
              <p className="text-xs text-gray-400">No version history yet.</p>
            ) : (
              <div className="space-y-1.5">
                {versions.map((v, i) => (
                  <div key={v.sha} className="flex items-center gap-3 text-xs text-gray-500">
                    <span className="font-mono text-gray-400 w-14 shrink-0">{v.sha.slice(0, 7)}</span>
                    <span className="flex-1 truncate" title={v.message}>
                      {i === 0 && <span className="text-green-600 font-medium">current — </span>}
                      {v.message}
                    </span>
                    <span className="shrink-0 text-gray-400">
                      {new Date(v.date).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </span>
                    {i > 0 && (
                      <button
                        onClick={() => handleRollback(v.sha)}
                        disabled={rollingBack === v.sha}
                        className="shrink-0 text-xs text-amber-600 hover:text-amber-800 font-medium disabled:opacity-50"
                      >
                        {rollingBack === v.sha ? "Restoring..." : "Restore"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          )}

          {/* Locations panel */}
          {bottomTab === "locations" && (
            locationsLoading ? (
              <p className="text-xs text-gray-400">Loading location pages...</p>
            ) : locations.length === 0 ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-xs text-gray-400">No location pages generated yet.</p>
                <p className="text-xs text-gray-400">Run: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">node scripts/generate-locations.js --site {siteId} --city &quot;City&quot; --state ST</code></p>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wide font-semibold">{locations.length} location pages</span>
                  {locationsMeta?.indexUrl && (
                    <a href={locationsMeta.indexUrl} target="_blank" rel="noopener" className="text-[10px] text-zing-teal hover:underline">View all →</a>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {locations.map((loc) => (
                    <div key={loc.slug} className="flex items-center justify-between gap-2 py-0.5">
                      <button
                        onClick={() => { setLocationPreview(loc.url); setRightTab("preview"); }}
                        className="text-xs text-gray-700 hover:text-zing-teal truncate text-left"
                        title={loc.label}
                      >
                        {loc.label}
                      </button>
                      <a href={loc.url} target="_blank" rel="noopener" className="text-[10px] text-gray-300 hover:text-zing-teal shrink-0">↗</a>
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* Concurrent edit conflict modal */}
      {conflictError && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3 mb-4">
              <span className="text-2xl leading-none">⚠️</span>
              <div>
                <h3 className="text-sm font-semibold text-gray-800 mb-1">Edit Conflict</h3>
                <p className="text-sm text-gray-500">This page was saved by someone else while you were editing. Your unsaved changes are still here.</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mb-5">Reload to get the latest version, then reapply your changes. Your AI chat history will be preserved.</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConflictError(null)}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-50 transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={() => { setConflictError(null); window.location.reload(); }}
                className="flex-1 px-4 py-2 bg-zing-teal text-white rounded-lg text-sm font-medium hover:bg-zing-dark transition-colors"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Page modal */}
      {showNewPageModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-semibold text-zing-dark">New Page</h3>
                <p className="text-xs text-gray-400 mt-0.5">Add a page to this site</p>
              </div>
              <button onClick={() => { setShowNewPageModal(false); setNewPageError(""); }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Page Name</label>
                <input
                  value={newPageName}
                  onChange={e => {
                    setNewPageName(e.target.value);
                    setNewPageSlug(e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
                  }}
                  placeholder="e.g. Services"
                  autoFocus
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                />
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">URL Slug</label>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">/</span>
                  <input
                    value={newPageSlug}
                    onChange={e => setNewPageSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    placeholder="services"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                  <span className="text-xs text-gray-400">/</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Copy Layout From</label>
                <select
                  value={newPageCloneFrom}
                  onChange={e => setNewPageCloneFrom(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                >
                  {pages.map(p => (
                    <option key={p.filename} value={p.filename}>{p.label} ({p.filename})</option>
                  ))}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">Copies the nav, header, footer, and styles. AI will update the page title and H1.</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newPageAddToNav}
                  onChange={e => setNewPageAddToNav(e.target.checked)}
                  className="mt-0.5 accent-zing-teal"
                />
                <div>
                  <p className="text-sm font-medium text-gray-700">Add to nav on all pages</p>
                  <p className="text-xs text-gray-400">AI will insert this page into the navigation bar on every existing page. Takes ~30s.</p>
                </div>
              </label>

              {newPageError && <p className="text-xs text-red-500">{newPageError}</p>}
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
              <button onClick={() => { setShowNewPageModal(false); setNewPageError(""); }} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
              <button
                onClick={createPage}
                disabled={newPageCreating || !newPageName.trim() || !newPageSlug.trim()}
                className="bg-zing-teal text-white px-5 py-2 rounded-lg text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {newPageCreating
                  ? <><span className="animate-spin">⟳</span> {newPageAddToNav ? "Creating + updating nav..." : "Creating..."}</>
                  : "Create Page"
                }
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Generate Locations modal */}
      {showLocModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col" style={{ maxHeight: "80vh" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-zing-dark">📍 Generate Location Pages</h3>
                <p className="text-xs text-gray-400 mt-0.5">Creates 50 SEO landing pages targeting nearby cities</p>
              </div>
              <button onClick={() => { if (!locRunning) setShowLocModal(false); }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>

            {/* Form */}
            {!locRunning && !locDone && (
              <div className="px-6 py-5 space-y-4 shrink-0">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Base City</label>
                    <input
                      value={locCity}
                      onChange={e => setLocCity(e.target.value)}
                      placeholder="Orange Park"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">State</label>
                    <input
                      value={locState}
                      onChange={e => setLocState(e.target.value.toUpperCase().slice(0, 2))}
                      placeholder="FL"
                      maxLength={2}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal uppercase"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Number of Pages</label>
                  <select
                    value={locCount}
                    onChange={e => setLocCount(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  >
                    <option value="25">25 pages</option>
                    <option value="50">50 pages (recommended)</option>
                    <option value="75">75 pages</option>
                    <option value="100">100 pages</option>
                  </select>
                </div>
                <p className="text-[11px] text-gray-400">Cities are selected by population × proximity — larger nearby cities rank first. Pages deploy automatically via GitHub Actions.</p>
              </div>
            )}

            {/* Progress log */}
            {(locRunning || locLog.length > 0) && (
              <div className="flex-1 overflow-y-auto px-6 py-3 font-mono text-[11px] space-y-0.5 bg-gray-50 border-t border-gray-100 min-h-0">
                {locLog.map((entry, i) => (
                  <div key={i} className={`leading-5 ${entry.type === "done" ? "text-green-600 font-semibold mt-2" : entry.type === "error" ? "text-red-500" : entry.status === "error" ? "text-red-400" : "text-gray-600"}`}>
                    {entry.text}
                  </div>
                ))}
                {locRunning && <div className="text-gray-400 animate-pulse">Running…</div>}
              </div>
            )}

            {/* Footer */}
            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
              {locDone ? (
                <>
                  <button onClick={() => { setShowLocModal(false); setLocLog([]); setLocDone(false); setBottomTab("locations"); }} className="text-xs text-zing-teal hover:underline">View in Locations tab →</button>
                  <button onClick={() => { setLocLog([]); setLocDone(false); }} className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded hover:bg-gray-200">Run again</button>
                </>
              ) : (
                <>
                  <button onClick={() => setShowLocModal(false)} disabled={locRunning} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40">Cancel</button>
                  <button
                    onClick={runGenerateLocations}
                    disabled={locRunning || !locCity.trim() || !locState.trim()}
                    className="bg-zing-teal text-white px-5 py-2 rounded-lg text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {locRunning ? <><span className="animate-spin">⟳</span> Generating…</> : "Generate Pages"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive confirmation modal */}
      {showArchiveModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-6">
            <h3 className="text-lg font-semibold text-zing-dark mb-2">
              Archive {site.business_name}?
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              The site will be hidden from Pixel. Files and deployment are not
              affected.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowArchiveModal(false)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleArchive}
                disabled={archiving}
                className="flex-1 bg-gray-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {archiving ? "Archiving..." : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function Field({
  label,
  value,
  onChange,
  helpText,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  helpText?: string;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1 truncate" title={label}>
        {label}
      </label>
      <textarea
        value={value}
        rows={1}
        onChange={(e) => { onChange(e.target.value); autoGrow(e.target); }}
        ref={(el) => autoGrow(el)}
        className="w-full min-w-0 px-2.5 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal bg-gray-50 focus:bg-white transition-colors resize-none overflow-hidden leading-snug"
      />
      {helpText && (
        <p className="text-xs text-gray-400 mt-0.5 break-words">{helpText}</p>
      )}
    </div>
  );
}
