"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import FontPicker from "@/components/FontPicker";
import PixelToolbar from "@/components/PixelToolbar";
import type { SelectionState } from "@/components/PixelToolbar";


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
  const [currentFont, setCurrentFont] = useState<string | undefined>();
  const [showSidebarFontPicker, setShowSidebarFontPicker] = useState(false);
  const pendingRebuildRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Parent toolbar state (driven by PIXEL_SELECTION_STATE from iframe)
  const [toolbarState, setToolbarState] = useState<SelectionState | null>(null);
  const [iframeRect, setIframeRect] = useState<DOMRect | null>(null);

  // Click-to-replace image state
  const [selectedImg, setSelectedImg] = useState<{ index: number; rawSrc: string; resolvedSrc: string; kind: "img" | "bg" } | null>(null);
  const [imgReplaceFile, setImgReplaceFile] = useState<File | null>(null);
  const [imgReplacing, setImgReplacing] = useState(false);
  const [imgReplaceError, setImgReplaceError] = useState("");
  const [imgReplaceSuccess, setImgReplaceSuccess] = useState(false);
  const imgReplaceInputRef = useRef<HTMLInputElement>(null);

  // Link edit popover state


  // Section context-menu state
  const [sectionHover] = [null]; // unused — kept for any remaining references
  const [sectionAction, setSectionAction] = useState<{ isHidden: boolean; sectionClass: string; mouseX: number; mouseY: number } | null>(null);

  // Widget insertion state
  const [widgetMode, setWidgetMode] = useState(false);
  const [widgetPickerOpen, setWidgetPickerOpen] = useState(false);
  const [widgetInsertInfo, setWidgetInsertInfo] = useState<{ afterSectionIndex: number; afterSectionHtml: string } | null>(null);

  // Link destination picker state
  const [linkDestOpen, setLinkDestOpen] = useState(false);
  const [linkDestOrigHtml, setLinkDestOrigHtml] = useState("");
  const [linkDestCurrentHref, setLinkDestCurrentHref] = useState("");
  const [linkDestTab, setLinkDestTab] = useState<"page" | "anchor" | "external" | "contact">("page");
  const [linkDestValue, setLinkDestValue] = useState("");
  const [linkContactType, setLinkContactType] = useState<"tel" | "mailto">("tel");

  // Image library state
  const [libraryImages, setLibraryImages] = useState<Array<{ name: string; url: string; size: number }>>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryUploading, setLibraryUploading] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const libraryUploadRef = useRef<HTMLInputElement>(null);
  const [libraryCopied, setLibraryCopied] = useState<string | null>(null);

  // Multi-page state
  type PageEntry = { filename: string; label: string; isHome: boolean; slug: string; isNav?: boolean };
  const [pages, setPages] = useState<PageEntry[]>([]);
  const [hasSubpages, setHasSubpages] = useState(false);
  const [showAllPages, setShowAllPages] = useState(false);
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

  // Custom domain / publishing flow
  const [domainInput, setDomainInput] = useState("");
  const [domainStatus, setDomainStatus] = useState<
    "idle" | "adding" | "pending" | "pending_nameservers" | "active" | "error"
  >("idle");
  const [domainError, setDomainError] = useState<string | null>(null);
  const [cnameTarget, setCnameTarget] = useState<string | null>(null);
  const [activeDomain, setActiveDomain] = useState<string | null>(null);
  const [removingDomain, setRemovingDomain] = useState(false);
  const domainPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // New publishing flow state
  const [domainType, setDomainType] = useState<"none" | "zing" | "custom">("none");
  const [zoneNameservers, setZoneNameservers] = useState<string[]>([]);
  const [importedRecords, setImportedRecords] = useState<Array<{
    id: string; type: string; name: string; content: string; priority?: number; ttl: number; proxied?: boolean;
  }>>([]);
  const [apexDomain, setApexDomain] = useState<string | null>(null);
  const [dnsExpanded, setDnsExpanded] = useState(false);
  const [registrarExpanded, setRegistrarExpanded] = useState(false);
  const [expandedRegistrar, setExpandedRegistrar] = useState<string | null>(null);
  const [instructionsSent, setInstructionsSent] = useState(false);
  const [sendingInstructions, setSendingInstructions] = useState(false);
  const [copiedNs, setCopiedNs] = useState<string | null>(null);

  // Inject <base href> so relative asset paths resolve to the deployed CF Pages origin.
  // For subdir pages (e.g. "about/index.html") base must point to that subdir,
  // otherwise relative paths like "../assets/x.jpg" resolve incorrectly.
  function buildBlobPreview(html: string, siteId: string, interactive = false, page = "index.html"): string {
    const pageDir = page.includes("/") ? page.substring(0, page.lastIndexOf("/") + 1) : "";
    const base = `<base href="https://${siteId}.pages.dev/${pageDir}">`;
    const interactionScript = interactive ? `
<style>
  [data-pixel-el] { cursor: pointer !important; }
  [data-pixel-el]:hover:not([data-pixel-selected]) { outline: 2px dashed #2a7c6f !important; outline-offset: 3px !important; }
  [data-pixel-el][data-pixel-selected] { outline: 3px solid #2a7c6f !important; outline-offset: 3px !important; box-shadow: 0 0 0 6px rgba(42,124,111,0.15) !important; }
  [data-pixel-text]:not([contenteditable="true"]) { cursor: text !important; }
  [data-pixel-text]:not([contenteditable="true"]):hover { outline: 2px dashed #2a7c6f !important; outline-offset: 2px !important; }
  [data-pixel-text][contenteditable="true"] { outline: 2px solid #2a7c6f !important; outline-offset: 2px !important; box-shadow: 0 0 0 4px rgba(42,124,111,0.12) !important; }
</style>
<script>
(function() {
  'use strict';
  var _imgSelected = null;
  var _editingEl = null;
  var _editingOrigHtml = '';
  // Save selection continuously so we can restore it after focus returns to iframe
  document.addEventListener('selectionchange', function() {
    if (!_editingEl) return;
    sendSelectionState();
  });

  // ─── Selection State → Parent ─────────────────────────────────────────────
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
        var m = c && c.match(/\\d+/g);
        if (m && m.length >= 3) return '#' + [m[0],m[1],m[2]].map(function(n){return ('0'+parseInt(n).toString(16)).slice(-2);}).join('');
        return '#000000';
      })(),
      hasSelection: !!hasSelection,
      elementTag: _editingEl.tagName.toLowerCase(),
      elementRect: { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right },
      isLink: !!(sel && sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('a[href]')),
      linkHref: (function() { var a = sel && sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('a[href]'); return a ? a.getAttribute('href') || '' : ''; })()
    }, '*');
  }

  // ─── Edit Session ─────────────────────────────────────────────────────────
  function cleanHtml(el) {
    var c = el.cloneNode(true);
    c.removeAttribute('contenteditable'); c.removeAttribute('data-pixel-text');
    return c.outerHTML;
  }

  // Called by parent when font family changes. Applies style, adds Google Fonts link,
  // and sends PIXEL_TEXT_CHANGE so localPages is updated and _editingOrigHtml stays in sync.
  window._pixelApplyFontFamily = function(family, linkHref) {
    if (!_editingEl) return;
    _editingEl.style.fontFamily = family;
    if (linkHref) {
      var existingLink = document.querySelector('link[data-pixel-font]');
      if (existingLink) { existingLink.href = linkHref; }
      else {
        var link = document.createElement('link');
        link.rel = 'stylesheet'; link.setAttribute('data-pixel-font', '1');
        link.href = linkHref; document.head.appendChild(link);
      }
    }
    var newHtml = cleanHtml(_editingEl);
    if (newHtml !== _editingOrigHtml) {
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:_editingOrigHtml, newHtml:newHtml, needsRebuild:false }, '*');
      _editingOrigHtml = newHtml;
    }
  };

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

  // Sync _editingOrigHtml with current element state WITHOUT ending the editing session.
  window._pixelSyncEdit = function() {
    if (!_editingEl) return;
    var newHtml = cleanHtml(_editingEl);
    if (newHtml !== _editingOrigHtml) {
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:_editingOrigHtml, newHtml:newHtml, needsRebuild:false }, '*');
      _editingOrigHtml = newHtml;
    }
  };

  // Called by parent before deploying to ensure any in-progress edit is saved to localPages.
  window._pixelSaveEdit = function() {
    if (_editingEl) saveCurrentEdit();
  };

  // Add, edit, or remove a link within the active text editing session.
  // href = '' removes the link; non-empty href adds or updates it.
  window._pixelSetLink = function(href) {
    if (!_editingEl) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var existingAnchor = sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest('a[href]');
    var orig = _editingOrigHtml;
    if (!href) {
      // Remove link — unwrap the <a> tag
      if (existingAnchor) {
        var parent = existingAnchor.parentNode;
        while (existingAnchor.firstChild) parent.insertBefore(existingAnchor.firstChild, existingAnchor);
        parent.removeChild(existingAnchor);
      }
    } else if (existingAnchor) {
      // Update existing link href
      existingAnchor.setAttribute('href', href);
    } else if (!sel.isCollapsed) {
      // Wrap selected text in a new <a>
      var range = sel.getRangeAt(0);
      var anchor = document.createElement('a');
      anchor.href = href;
      try { range.surroundContents(anchor); }
      catch(e) { anchor.appendChild(range.extractContents()); range.insertNode(anchor); }
    }
    // Sync to localPages via PIXEL_TEXT_CHANGE
    var newHtml = cleanHtml(_editingEl);
    if (newHtml !== orig) {
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:orig, newHtml:newHtml, needsRebuild:false }, '*');
      _editingOrigHtml = newHtml;
    }
    // Re-send selection state so toolbar isLink updates
    sendSelectionState();
  };

  // Called by parent to hide or show the pending section.
  window._pixelToggleSection = function(hide) {
    var section = window._pendingSectionEl;
    if (!section) return;
    var origHtml = section.outerHTML;
    if (hide) {
      section.dataset.pixelHidden = 'true';
      var newHtml = section.outerHTML;
      // Apply visual placeholder styles directly to live DOM (not serialized)
      section.style.display = 'block';
      section.style.opacity = '0.3';
      section.style.minHeight = '40px';
      section.style.background = 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#e5e7eb 10px,#e5e7eb 20px)';
      section.style.border = '2px dashed #9ca3af';
      section.style.borderRadius = '4px';
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origHtml, newHtml:newHtml, needsRebuild:false }, '*');
    } else {
      delete section.dataset.pixelHidden;
      section.style.display = '';
      section.style.opacity = '';
      section.style.minHeight = '';
      section.style.background = '';
      section.style.border = '';
      section.style.borderRadius = '';
      var newHtml = section.outerHTML;
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origHtml, newHtml:newHtml, needsRebuild:false }, '*');
    }
    window._pendingSectionEl = null;
  };

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
    newEl.contentEditable = 'true';
    newEl.focus({ preventScroll: true });
    requestAnimationFrame(function() { sendSelectionState(); });
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
    window.parent.postMessage({ type:'PIXEL_SELECTION_STATE', isEditing:false }, '*');
    window.parent.postMessage({ type:'PIXEL_TEXT_END' }, '*');
  }

  // ─── Global Listeners ─────────────────────────────────────────────────────
  document.addEventListener('keydown', function(e) {
    if (!_editingEl || !_editingEl.isContentEditable) return;
    if (e.key === 'Escape') { saveCurrentEdit(); return; }
    if (e.key === 'Enter' && !e.shiftKey) {
      var t = _editingEl.tagName.toLowerCase();
      if (t !== 'p' && t !== 'li') { e.preventDefault(); saveCurrentEdit(); }
    }
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
  var _deleteBtn = null;
  var _deleteBtnTarget = null;

  function removeDeleteBtn() {
    if (_deleteBtn && _deleteBtn.parentNode) _deleteBtn.parentNode.removeChild(_deleteBtn);
    _deleteBtn = null; _deleteBtnTarget = null;
  }

  function makeTextEditable(el, index) {
    var origHtml = el.outerHTML; // captured BEFORE data-pixel-text
    el.setAttribute('data-pixel-text', index);

    el.addEventListener('mouseenter', function() {
      if (el.isContentEditable) return;
      removeDeleteBtn();
      var rect = el.getBoundingClientRect();
      var btn = document.createElement('div');
      btn.textContent = '\\u00d7';
      btn.style.cssText = 'position:fixed;top:' + rect.top + 'px;left:' + (rect.right - 20) + 'px;width:20px;height:20px;background:#ef4444;color:#fff;font-size:14px;line-height:20px;text-align:center;border-radius:50%;cursor:pointer;z-index:9999;user-select:none;';
      document.body.appendChild(btn);
      _deleteBtn = btn; _deleteBtnTarget = el;

      btn.addEventListener('mouseenter', function() { /* keep visible */ });
      btn.addEventListener('mouseleave', function() { removeDeleteBtn(); });
      btn.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        var orig = el.outerHTML;
        el.parentNode.removeChild(el);
        window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:orig, newHtml:'', needsRebuild:false }, '*');
        removeDeleteBtn();
      });
    });

    el.addEventListener('mouseleave', function(e) {
      if (_deleteBtn && e.relatedTarget === _deleteBtn) return;
      setTimeout(function() {
        if (_deleteBtnTarget === el) removeDeleteBtn();
      }, 100);
    });

    el.addEventListener('click', function(e) {
      if (e.target.closest('[data-pixel-el]')) return;
      e.stopPropagation();
      if (el.isContentEditable) {
        // Already in edit mode — do NOT call activateEdit (it runs
        // caretRangeFromPoint which destroys any drag-selection).
        // Toolbar stays where it is; no repositioning on every click.
        return;
      }
      if (_imgSelected) { clearImgSelection(); window.parent.postMessage({ type:'PIXEL_DESELECT' }, '*'); }
      activateEdit(el, origHtml, e.clientX, e.clientY);
    });
  }

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
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

    // ─── Button/Link Destination Detection ──────────────────────────────────
    var linkSels = ['a[href]','button','[class*="btn"]','[class*="cta"]','[class*="button"]'];
    var linkEls = [];
    linkSels.forEach(function(s) {
      document.querySelectorAll(s).forEach(function(el) {
        if (el.tagName === 'DIV' || el.tagName === 'SECTION') return;
        if (el.querySelector('img') || !el.textContent.trim()) return;
        if (linkEls.indexOf(el) === -1) linkEls.push(el);
      });
    });
    linkEls.forEach(function(el) {
      el.addEventListener('contextmenu', function(e) {
        e.preventDefault(); e.stopPropagation();
        var href = '';
        if (el.tagName === 'A') href = el.getAttribute('href') || '';
        else {
          var closestA = el.closest('a[href]');
          if (closestA) href = closestA.getAttribute('href') || '';
        }
        window._pendingLinkEl = el;
        window.parent.postMessage({ type:'PIXEL_LINK_DEST_EDIT', originalHtml:el.outerHTML, currentHref:href, rect:{ top:el.getBoundingClientRect().top, left:el.getBoundingClientRect().left, width:el.getBoundingClientRect().width, height:el.getBoundingClientRect().height } }, '*');
      });
    });

    // Text
    var tIdx = 0;
    document.querySelectorAll('h1,h2,h3,h4,h5,h6,button,[class*="btn"],[class*="cta"]').forEach(function(el) {
      if (el.querySelector('img') || !el.textContent.trim()) return;
      makeTextEditable(el, tIdx++);
    });
    document.querySelectorAll('p,li').forEach(function(el) {
      if (el.textContent.trim().length < 5 || el.querySelector('img')) return;
      makeTextEditable(el, tIdx++);
    });



    // ─── Empty Image Upload Prompts ──────────────────────────────────────────
    document.querySelectorAll('img').forEach(function(img, i) {
      var src = img.getAttribute('src') || '';
      if (src && src !== '#' && src.length >= 5 && !src.startsWith('data:image/gif;base64,R0lGOD')) return;
      img.style.position = 'relative';
      var wrapper = img.parentNode;
      if (wrapper) wrapper.style.position = 'relative';
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;min-height:60px;display:flex;align-items:center;justify-content:center;background:rgba(243,244,246,0.85);border:2px dashed #9ca3af;border-radius:4px;cursor:pointer;z-index:10;font-family:system-ui,sans-serif;font-size:14px;color:#6b7280;';
      overlay.textContent = '\\ud83d\\udcf7 Click to upload image';
      if (wrapper && wrapper !== document.body) {
        wrapper.style.position = 'relative';
        wrapper.insertBefore(overlay, img.nextSibling);
      } else {
        img.insertAdjacentElement('afterend', overlay);
      }
      overlay.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
        window.parent.postMessage({ type:'PIXEL_IMG_CLICK', index:i, kind:'img', rawSrc:'', resolvedSrc:'' }, '*');
      });
    });

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
      if (section.offsetHeight < 60) return;
      if (section.hasAttribute('data-pixel-text') || section.hasAttribute('data-pixel-el')) return;

      section.addEventListener('contextmenu', function(e) {
        e.preventDefault(); e.stopPropagation();
        if (_editingEl) return;
        var rect = section.getBoundingClientRect();
        var isHidden = section.dataset.pixelHidden === 'true';
        window._pendingSectionEl = section;
        window.parent.postMessage({
          type: 'PIXEL_SECTION_CLICK',
          isHidden: isHidden,
          rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          sectionClass: section.className.slice(0, 60),
          mouseX: e.clientX,
          mouseY: e.clientY
        }, '*');
      });
    });

    // Show hidden sections as collapsed placeholders in editor view
    document.querySelectorAll('[data-pixel-hidden="true"]').forEach(function(section) {
      section.style.display = 'block';
      section.style.opacity = '0.3';
      section.style.minHeight = '40px';
      section.style.background = 'repeating-linear-gradient(45deg,#f3f4f6,#f3f4f6 10px,#e5e7eb 10px,#e5e7eb 20px)';
      section.style.border = '2px dashed #9ca3af';
      section.style.borderRadius = '4px';
    });

    // Save text / deselect image when clicking outside relevant elements
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
  }

  // Handle commands from parent that require complex DOM restructuring
  // (formatting commands are now handled directly by the parent via contentDocument access)
  window.addEventListener('message', function(e) {
    var d = e.data;
    if (!d || !d.type) return;
    if (d.type === 'PIXEL_CONVERT_TAG') {
      if (_editingEl) convertTag(d.tag);
    } else if (d.type === 'PIXEL_CONVERT_LIST') {
      if (_editingEl) convertToList(d.listTag);
    } else if (d.type === 'PIXEL_WIDGET_MODE') {
      // Clean up any existing overlay first
      var existingOv = document.getElementById('zing-widget-overlay');
      if (existingOv) existingOv.parentNode.removeChild(existingOv);

      if (d.on) {
        // Collect major top-level sections only.
        // Strategy: find all candidate elements, then keep only those that are
        // NOT nested inside another candidate (dedupe to outermost elements only).
        var widgetSels = ['body > section','body > div[class]','main > section','main > div[class]','[class*="section"]','[class*="hero"]','[class*="about"]','[class*="services"]','[class*="contact"]','[class*="footer"]','[class*="gallery"]','[class*="cta"]','[class*="testimonial"]'];
        var candidates = [];
        var seenCandidates = [];
        document.querySelectorAll(widgetSels.join(',')).forEach(function(el) {
          if (el.offsetHeight < 80) return;
          if (el.tagName === 'NAV' || el.closest('nav')) return;
          if (seenCandidates.indexOf(el) === -1) seenCandidates.push(el) && candidates.push(el);
        });
        // Keep only outermost: drop any element that has an ancestor in the candidate list
        var sections = candidates.filter(function(el) {
          return !candidates.some(function(other) { return other !== el && other.contains(el); });
        });

        // Create a non-invasive overlay — does NOT touch the page DOM structure
        var scrollH = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 2000);
        var ov = document.createElement('div');
        ov.id = 'zing-widget-overlay';
        ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:'+scrollH+'px;z-index:9998;pointer-events:none;';
        document.body.style.position = 'relative';
        document.body.appendChild(ov);

        function makeInsertBar(yCenter, targetSection, idx) {
          var bar = document.createElement('div');
          // Large 48px hit-target, centered on the gap
          bar.style.cssText = 'position:absolute;left:0;right:0;top:'+(yCenter-24)+'px;height:48px;pointer-events:all;cursor:pointer;display:flex;align-items:center;justify-content:center;';

          var line = document.createElement('div');
          line.style.cssText = 'position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:3px;background:#2a7c6f;opacity:0;transition:opacity 0.15s;border-radius:2px;';

          var btn = document.createElement('div');
          btn.textContent = '+';
          btn.style.cssText = 'background:#2a7c6f;color:white;border-radius:50%;width:32px;height:32px;font-size:22px;line-height:30px;text-align:center;font-weight:700;opacity:0;transition:opacity 0.15s;position:relative;z-index:1;box-shadow:0 2px 8px rgba(0,0,0,0.25);user-select:none;';

          bar.appendChild(line);
          bar.appendChild(btn);

          bar.addEventListener('mouseenter', function() { line.style.opacity='1'; btn.style.opacity='1'; });
          bar.addEventListener('mouseleave', function() { line.style.opacity='0'; btn.style.opacity='0'; });
          bar.addEventListener('click', function(e) {
            e.preventDefault(); e.stopPropagation();
            window._pendingInsertTarget = targetSection;
            window.parent.postMessage({ type:'PIXEL_INSERT_REQUEST', afterSectionIndex:idx }, '*');
          });
          ov.appendChild(bar);
        }

        var scrollY = window.scrollY || window.pageYOffset || 0;

        // Bar before first section
        if (sections.length > 0) {
          var r0 = sections[0].getBoundingClientRect();
          makeInsertBar(r0.top + scrollY - 8, null, 0);
        }

        // Bars between sections + after last
        for (var si = 0; si < sections.length; si++) {
          var rA = sections[si].getBoundingClientRect();
          var yAfter;
          if (si < sections.length - 1) {
            var rB = sections[si+1].getBoundingClientRect();
            yAfter = ((rA.bottom + rB.top) / 2) + scrollY;
          } else {
            yAfter = rA.bottom + scrollY + 8;
          }
          makeInsertBar(yAfter, sections[si], si + 1);
        }
      }
    } else if (d.type === 'PIXEL_DO_INSERT') {
      // Always remove the overlay first so it doesn't interfere
      var ovEl = document.getElementById('zing-widget-overlay');
      if (ovEl) ovEl.parentNode.removeChild(ovEl);

      var target = window._pendingInsertTarget;
      var tmp = document.createElement('div');
      tmp.innerHTML = d.widgetHtml;
      var widget = tmp.firstElementChild;
      if (!widget) return;

      // Find the right container to insert into.
      // Walk UP from the target element until we reach a container whose own parent
      // is NOT a flex-row or grid (those would push our block widget sideways).
      function findBlockContainer(el) {
        if (!el) return { anchor: null, container: document.body };
        var cur = el;
        while (cur && cur.parentElement && cur.parentElement !== document.documentElement) {
          var ps = window.getComputedStyle(cur.parentElement);
          var isRowFlex = (ps.display === 'flex' || ps.display === 'inline-flex') &&
                          ps.flexDirection !== 'column' && ps.flexDirection !== 'column-reverse';
          var isGrid = (ps.display === 'grid' || ps.display === 'inline-grid');
          if (!isRowFlex && !isGrid) {
            // Parent is a block/column-flex — safe to insert here
            return { anchor: cur, container: cur.parentElement };
          }
          cur = cur.parentElement;
        }
        // Fallback: insert directly in body
        return { anchor: cur || el, container: document.body };
      }

      var insertInfo = findBlockContainer(target);
      var insertAnchor = insertInfo.anchor;
      var insertContainer = insertInfo.container;

      // Capture original sibling HTML for undo tracking
      var insertOriginal = insertAnchor ? insertAnchor.outerHTML : null;
      if (insertAnchor && insertContainer) {
        if (insertAnchor.nextSibling) {
          insertContainer.insertBefore(widget, insertAnchor.nextSibling);
        } else {
          insertContainer.appendChild(widget);
        }
        var insertNew = insertOriginal + widget.outerHTML;
        window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:insertOriginal, newHtml:insertNew, needsRebuild:false }, '*');
      } else {
        document.body.appendChild(widget);
        window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:'</body>', newHtml:widget.outerHTML+'</body>', needsRebuild:false }, '*');
      }
      // Wire up interactivity on the newly inserted widget
      var wIdx = document.querySelectorAll('[data-pixel-text]').length;
      widget.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,button,[class*="btn"],[class*="cta"]').forEach(function(el) {
        if (!el.textContent.trim() || el.hasAttribute('data-pixel-text')) return;
        makeTextEditable(el, wIdx++);
      });
      var wiIdx = document.querySelectorAll('[data-pixel-el]').length;
      widget.querySelectorAll('img').forEach(function(img) {
        if (img.hasAttribute('data-pixel-el')) return;
        makeImageClickable(img, wiIdx++, 'img', img.getAttribute('src') || '');
      });
      window._pendingInsertTarget = null;
      // Scroll the new widget into view
      try { widget.scrollIntoView({ behavior:'smooth', block:'center' }); } catch(e) {}
    } else if (d.type === 'PIXEL_SET_LINK') {
      var linkEl = window._pendingLinkEl;
      if (!linkEl) return;
      var origH = linkEl.outerHTML;
      if (linkEl.tagName === 'A') {
        linkEl.setAttribute('href', d.href);
        window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origH, newHtml:linkEl.outerHTML, needsRebuild:false }, '*');
      } else {
        var aWrap = document.createElement('a');
        aWrap.setAttribute('href', d.href);
        linkEl.parentNode.insertBefore(aWrap, linkEl);
        aWrap.appendChild(linkEl);
        window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origH, newHtml:aWrap.outerHTML, needsRebuild:false }, '*');
      }
      window._pendingLinkEl = null;
    } else if (d.type === 'PIXEL_SET_IMAGE_URL') {
      var imgEl = null;
      if (d.kind === 'img') imgEl = document.querySelector('img[src="'+d.rawSrc+'"]');
      else imgEl = document.querySelector('[style*="'+d.rawSrc+'"]');
      if (!imgEl) return;
      var origImg = imgEl.outerHTML;
      if (d.kind === 'img') imgEl.setAttribute('src', d.newSrc);
      else imgEl.style.backgroundImage = 'url('+d.newSrc+')';
      window.parent.postMessage({ type:'PIXEL_TEXT_CHANGE', originalHtml:origImg, newHtml:imgEl.outerHTML, needsRebuild:false }, '*');
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

  function buildWidgetHtml(type: string): string {
    // Widgets are full-width sections so they fit naturally into the page flow
    switch (type) {
      case "text":
        return '<section class="zing-widget zing-text-widget" style="width:100%;padding:60px 40px;box-sizing:border-box;background:#fff;">' +
          '<div style="max-width:900px;margin:0 auto;">' +
          '<p style="font-size:17px;line-height:1.8;color:#444;margin:0;">Click to edit this text block.</p>' +
          '</div></section>';
      case "heading":
        return '<section class="zing-widget zing-heading-widget" style="width:100%;padding:60px 40px;box-sizing:border-box;background:#fff;text-align:center;">' +
          '<div style="max-width:900px;margin:0 auto;">' +
          '<h2 style="font-size:36px;font-weight:700;color:#222;margin:0 0 16px 0;">Your Heading Here</h2>' +
          '<p style="font-size:17px;line-height:1.7;color:#666;margin:0;">Supporting text goes here. Click to edit.</p>' +
          '</div></section>';
      case "gallery":
        return '<section class="zing-widget zing-gallery-widget" data-cols="3" style="width:100%;padding:60px 40px;box-sizing:border-box;background:#f9f9f9;">' +
          '<div style="max-width:1200px;margin:0 auto;">' +
          '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:20px;">' +
          '<div class="zing-gallery-item"><img src="" alt="Gallery image 1" style="width:100%;height:240px;object-fit:cover;border-radius:6px;display:block;background:#e5e7eb;"></div>' +
          '<div class="zing-gallery-item"><img src="" alt="Gallery image 2" style="width:100%;height:240px;object-fit:cover;border-radius:6px;display:block;background:#e5e7eb;"></div>' +
          '<div class="zing-gallery-item"><img src="" alt="Gallery image 3" style="width:100%;height:240px;object-fit:cover;border-radius:6px;display:block;background:#e5e7eb;"></div>' +
          '</div></div></section>';
      case "divider":
        return '<div class="zing-widget zing-divider-widget" style="width:100%;padding:8px 40px;box-sizing:border-box;">' +
          '<hr style="border:none;border-top:2px solid #e5e7eb;margin:0;"></div>';
      default:
        return "";
    }
  }

  function insertWidget(type: string) {
    const html = buildWidgetHtml(type);
    if (!html) return;
    const iframeWin = iframeRef.current?.contentWindow;
    if (iframeWin) {
      iframeWin.postMessage({ type: "PIXEL_DO_INSERT", widgetHtml: html }, "*");
    }
    setWidgetPickerOpen(false);
    setWidgetMode(false);
    // Tell iframe to exit widget mode
    if (iframeWin) {
      iframeWin.postMessage({ type: "PIXEL_WIDGET_MODE", on: false }, "*");
    }
  }

  async function fetchLibrary() {
    setLibraryLoading(true);
    try {
      const res = await fetch(`/api/sites/${siteId}/library`);
      if (res.ok) {
        const data = await res.json();
        setLibraryImages(data.images ?? []);
      }
    } catch { /* ignore */ } finally {
      setLibraryLoading(false);
    }
  }

  async function handleLibraryUpload(file: File) {
    setLibraryUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/sites/${siteId}/library`, { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setLibraryImages(prev => [{ name: data.name, url: data.url, size: file.size }, ...prev]);
      }
    } catch { /* ignore */ } finally {
      setLibraryUploading(false);
    }
  }

  async function deleteLibraryImage(name: string) {
    try {
      await fetch(`/api/sites/${siteId}/library/${encodeURIComponent(name)}`, { method: "DELETE" });
      setLibraryImages(prev => prev.filter(i => i.name !== name));
    } catch { /* ignore */ }
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
    const preview = buildBlobPreview(html, siteId, true, currentPage);
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
    // Flush any in-progress text edit so localPages has the latest content
    const iframeWin = iframeRef.current?.contentWindow as any;
    if (typeof iframeWin?._pixelSaveEdit === "function") iframeWin._pixelSaveEdit();
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

  async function deployAllPages() {
    if (dirtyCount === 0) return;
    // Flush any in-progress text edit first
    const iframeWin = iframeRef.current?.contentWindow as any;
    if (typeof iframeWin?._pixelSaveEdit === "function") iframeWin._pixelSaveEdit();
    await new Promise(r => setTimeout(r, 80));
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

  function toggleSection(hide: boolean) {
    const iframeWin = iframeRef.current?.contentWindow as any;
    if (typeof iframeWin?._pixelToggleSection === "function") {
      iframeWin._pixelToggleSection(hide);
    }
    setDirtyPages(d => new Set([...d, currentPage]));
    setSectionAction(null);
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
      const preview = buildBlobPreview(data.html, siteId, true, currentPage);
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
      if (typeof data.hasSubpages === "boolean") setHasSubpages(data.hasSubpages);
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
    await fetch(`/api/sites/${siteId}/pages/${filename.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
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
    // Use iframe's exposed function so the change goes through PIXEL_TEXT_CHANGE,
    // updating localPages + _editingOrigHtml in sync (prevents revert on blob rebuild)
    const iframeWin = iframeRef.current?.contentWindow as any;
    if (typeof iframeWin?._pixelApplyFontFamily === "function") {
      iframeWin._pixelApplyFontFamily(family, linkHref);
    }
    // Also persist the Google Fonts link in localHtml <head>
    if (linkHref) {
      setLocalPages(prev => {
        const current = prev[currentPage];
        if (!current) return prev;
        if (current.includes(linkHref)) return prev;
        const stripped = current.replace(/<link[^>]+data-pixel-font[^>]+>/g, "");
        const tag = `<link rel="stylesheet" href="${linkHref}" data-pixel-font="true">`;
        const updated = stripped.includes("</head>")
          ? stripped.replace("</head>", `${tag}\n</head>`)
          : tag + stripped;
        return { ...prev, [currentPage]: updated };
      });
    }
  }

  // Rebuild blob when structural text changes (tag/list conversion) are pending
  useEffect(() => {
    if (!pendingRebuildRef.current) return;
    const html = localPages[currentPage];
    if (!html) return;
    pendingRebuildRef.current = false;
    revokeBlobUrl();
    const preview = buildBlobPreview(html, siteId, true, currentPage);
    setBlobUrl(URL.createObjectURL(new Blob([preview], { type: "text/html" })));
    setPreviewKey(k => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPages]);

  // Load existing domain/zone status on mount
  async function fetchDomains() {
    const res = await fetch(`/api/sites/${siteId}/domain`);
    const data = await res.json();

    if (data.type === "custom") {
      setDomainType("custom");
      setApexDomain(data.apexDomain);
      setZoneNameservers(data.nameservers ?? []);
      setActiveDomain(data.apexDomain ? `www.${data.apexDomain}` : null);
      if (data.status === "active") {
        setDomainStatus("active");
      } else {
        setDomainStatus("pending_nameservers");
        startZonePolling();
      }
    } else if (data.type === "zing") {
      setDomainType("zing");
      setActiveDomain(data.domain);
      setDomainStatus(data.status === "active" ? "active" : "pending");
      if (data.status !== "active") {
        setCnameTarget(data.verification_data?.cname_target ?? `${siteId}.pages.dev`);
        startZingPolling(data.domain);
      }
    }
  }

  function startZonePolling() {
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    domainPollRef.current = setInterval(async () => {
      const res = await fetch(`/api/sites/${siteId}/domain`);
      const data = await res.json();
      if (data.status === "active") {
        clearInterval(domainPollRef.current!);
        domainPollRef.current = null;
        setDomainStatus("active");
        await fetchSite();
      }
    }, 30000);
  }

  function startZingPolling(domain: string) {
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    domainPollRef.current = setInterval(async () => {
      const res = await fetch(`/api/sites/${siteId}/domain`);
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

  async function checkNowZone() {
    const res = await fetch(`/api/sites/${siteId}/domain`);
    const data = await res.json();
    if (data.status === "active") {
      if (domainPollRef.current) clearInterval(domainPollRef.current);
      domainPollRef.current = null;
      setDomainStatus("active");
      await fetchSite();
    }
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

    if (data.type === "zing") {
      setDomainType("zing");
      setActiveDomain(data.domain);
      if (data.status === "active") {
        setDomainStatus("active");
        await fetchSite();
      } else {
        setDomainStatus("pending");
        setCnameTarget(`${siteId}.pages.dev`);
        startZingPolling(data.domain);
      }
    } else if (data.type === "custom") {
      setDomainType("custom");
      setApexDomain(data.apexDomain);
      setActiveDomain(data.wwwDomain);
      setZoneNameservers(data.nameservers);
      setImportedRecords(data.importedRecords ?? []);
      setDomainStatus("pending_nameservers");
      startZonePolling();
    }
    setDomainInput("");
  }

  async function handleSendInstructions() {
    if (!apexDomain || !zoneNameservers.length) return;
    setSendingInstructions(true);
    await fetch(`/api/sites/${siteId}/domain/send-instructions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: apexDomain, nameservers: zoneNameservers }),
    });
    setInstructionsSent(true);
    setSendingInstructions(false);
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedNs(text);
    setTimeout(() => setCopiedNs(null), 2000);
  }

  async function handleRemoveDomain() {
    if (!activeDomain && !apexDomain) return;
    setRemovingDomain(true);
    if (domainPollRef.current) clearInterval(domainPollRef.current);
    await fetch(`/api/sites/${siteId}/domain`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: activeDomain }),
    });
    setActiveDomain(null);
    setDomainStatus("idle");
    setDomainType("none");
    setCnameTarget(null);
    setApexDomain(null);
    setZoneNameservers([]);
    setImportedRecords([]);
    setInstructionsSent(false);
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
        const preview = buildBlobPreview(restoreHtml, siteId, true, currentPage);
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
        const preview = buildBlobPreview(restoreHtml, siteId, true, currentPage);
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
        setShowSidebarFontPicker(false);
      } else if (e.data?.type === "PIXEL_SELECTION_STATE") {
        if (e.data.isEditing) {
          setToolbarState(e.data as SelectionState);
          if (iframeRef.current) {
            setIframeRect(iframeRef.current.getBoundingClientRect());
          }
        } else {
          setToolbarState(null);
        }
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
      } else if (e.data?.type === "PIXEL_SECTION_CLICK") {
        setSectionAction({
          isHidden: e.data.isHidden,
          sectionClass: e.data.sectionClass,
          mouseX: (iframeRect?.left ?? 0) + e.data.mouseX,
          mouseY: (iframeRect?.top ?? 0) + e.data.mouseY,
        });
      } else if (e.data?.type === "PIXEL_INSERT_REQUEST") {
        setWidgetInsertInfo({ afterSectionIndex: e.data.afterSectionIndex, afterSectionHtml: e.data.afterSectionHtml });
        setWidgetPickerOpen(true);
      } else if (e.data?.type === "PIXEL_LINK_DEST_EDIT") {
        const href = e.data.currentHref || "";
        setLinkDestOrigHtml(e.data.originalHtml);
        setLinkDestCurrentHref(href);
        setLinkDestValue(href);
        // Auto-detect tab
        if (href.startsWith("#")) setLinkDestTab("anchor");
        else if (href.startsWith("tel:") || href.startsWith("mailto:")) {
          setLinkDestTab("contact");
          setLinkContactType(href.startsWith("tel:") ? "tel" : "mailto");
          setLinkDestValue(href);
        }
        else if (href.startsWith("http")) setLinkDestTab("external");
        else setLinkDestTab("page");
        setLinkDestOpen(true);
      } else if (e.data?.type === "PIXEL_SET_IMAGE_URL") {
        setDirtyPages(d => new Set([...d, currentPage]));
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Close link popover and section context menu on outside click
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-pixel-popover]")) {
        setSectionAction(null);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
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

  // Reload preview whenever the active page changes (blobUrl was cleared by the page picker click)
  useEffect(() => {
    if (!siteId || rightTab !== "preview") return;
    loadInteractivePreview();
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
      const preview = buildBlobPreview(data.html, siteId, true, currentPage);
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
        currentHtml: localPages[currentPage] ?? null,
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
        const preview = buildBlobPreview(data.html, siteId, true, currentPage);
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
      {/* Parent-document toolbar — clicking here never steals iframe selection */}
      {rightTab === "preview" && (
        <PixelToolbar
          state={toolbarState}
          iframeRef={iframeRef}
          iframeRect={iframeRect}
          onFontSelect={(family, linkHref) => {
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
      )}
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
                Go Live
              </p>
              {domainStatus === "active" && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Live
                </span>
              )}
              {(domainStatus === "pending" || domainStatus === "pending_nameservers") && (
                <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
                  {domainStatus === "pending_nameservers" ? "Pending Nameservers" : "Pending DNS"}
                </span>
              )}
            </div>

            {/* Active domain header + remove */}
            {activeDomain && (
              <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-md px-3 py-2 mb-2">
                <span className="text-sm font-medium text-zing-dark">{activeDomain}</span>
                <button
                  onClick={handleRemoveDomain}
                  disabled={removingDomain}
                  className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                >
                  {removingDomain ? "Removing..." : "Remove"}
                </button>
              </div>
            )}

            {/* ── Live state ── */}
            {domainStatus === "active" && site?.live_url && (
              <a
                href={site.live_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center text-xs text-zing-teal hover:underline mb-2"
              >
                Open live site ↗
              </a>
            )}

            {/* ── ZING subdomain pending ── */}
            {domainType === "zing" && domainStatus === "pending" && cnameTarget && (
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
                <p className="text-amber-600">Checking every 15s — this page will update automatically.</p>
              </div>
            )}

            {/* ── Custom domain: DNS review + nameservers + polling ── */}
            {domainType === "custom" && domainStatus === "pending_nameservers" && (
              <div className="space-y-3">

                {/* DNS Review Panel */}
                {importedRecords.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-md overflow-hidden">
                    <button
                      onClick={() => setDnsExpanded(!dnsExpanded)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-blue-800 hover:bg-blue-100 transition-colors"
                    >
                      <span>DNS Records Imported ({importedRecords.length})</span>
                      <svg className={`w-3.5 h-3.5 transition-transform ${dnsExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                    </button>
                    {dnsExpanded && (
                      <div className="px-3 pb-3 space-y-1">
                        {/* Group by type */}
                        {["MX", "TXT", "A", "AAAA", "CNAME", "NS", "SRV"].map((type) => {
                          const records = importedRecords.filter((r) => r.type === type);
                          if (!records.length) return null;
                          return (
                            <div key={type}>
                              <p className="text-[10px] font-bold text-blue-700 uppercase mt-1">{type}</p>
                              {records.map((r) => (
                                <div key={r.id} className="font-mono text-[11px] text-blue-900 pl-2 truncate">
                                  {r.name} → {r.content}
                                  {r.priority !== undefined && ` (priority ${r.priority})`}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                        {/* Remaining types */}
                        {importedRecords.filter((r) => !["MX", "TXT", "A", "AAAA", "CNAME", "NS", "SRV"].includes(r.type)).length > 0 && (
                          <div>
                            <p className="text-[10px] font-bold text-blue-700 uppercase mt-1">Other</p>
                            {importedRecords.filter((r) => !["MX", "TXT", "A", "AAAA", "CNAME", "NS", "SRV"].includes(r.type)).map((r) => (
                              <div key={r.id} className="font-mono text-[11px] text-blue-900 pl-2 truncate">
                                {r.type} {r.name} → {r.content}
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] text-blue-600 mt-2 italic">
                          Review above records. Fix any issues in Cloudflare before proceeding.
                        </p>
                        <div className="bg-white border border-blue-200 rounded px-2 py-1.5 mt-1">
                          <p className="text-[11px] font-medium text-blue-800">
                            Website CNAME added: www → {siteId}.pages.dev
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Nameserver Instructions */}
                <div className="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2">
                  <p className="text-xs font-medium text-gray-800">
                    Send these nameservers to {site?.business_name ?? "the customer"}:
                  </p>
                  {zoneNameservers.map((ns) => (
                    <div key={ns} className="flex items-center justify-between bg-white border border-gray-200 rounded px-2 py-1.5">
                      <span className="font-mono text-xs text-gray-900">{ns}</span>
                      <button
                        onClick={() => copyToClipboard(ns)}
                        className="text-[10px] text-zing-teal hover:underline font-medium ml-2"
                      >
                        {copiedNs === ns ? "Copied!" : "Copy"}
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={handleSendInstructions}
                    disabled={sendingInstructions || instructionsSent}
                    className="w-full mt-1 bg-zing-teal text-white px-3 py-2 rounded-md text-xs font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
                  >
                    {instructionsSent ? "Instructions Sent" : sendingInstructions ? "Sending..." : "Send Instructions"}
                  </button>
                </div>

                {/* Activation Polling */}
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-amber-500 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-xs text-amber-800">Checking nameserver propagation...</span>
                  </div>
                  <button
                    onClick={checkNowZone}
                    className="text-[10px] text-amber-700 hover:text-amber-900 font-medium underline"
                  >
                    Check Now
                  </button>
                </div>

                {/* Registrar Guides */}
                <div className="border border-gray-200 rounded-md overflow-hidden">
                  <button
                    onClick={() => setRegistrarExpanded(!registrarExpanded)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
                  >
                    <span>Registrar Guides</span>
                    <svg className={`w-3.5 h-3.5 transition-transform ${registrarExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {registrarExpanded && (
                    <div className="border-t border-gray-200">
                      {[
                        { name: "GoDaddy", steps: "My Products → DNS → Nameservers → Change → Enter Custom → Paste ns1/ns2" },
                        { name: "Namecheap", steps: "Domain List → Manage → Nameservers → Custom DNS → Paste ns1/ns2" },
                        { name: "Squarespace", steps: "Domains → [domain] → DNS Settings → Nameservers → Use custom nameservers" },
                        { name: "Cloudflare", steps: "Already on CF — change to: ns1.cloudflare.com / ns2.cloudflare.com" },
                        { name: "Google Domains", steps: "DNS → Nameservers → Edit → Paste ns1/ns2" },
                        { name: "Network Solutions", steps: "Account Manager → Manage Domain Names → Edit DNS → Nameservers" },
                      ].map((reg) => (
                        <div key={reg.name} className="border-t border-gray-100 first:border-t-0">
                          <button
                            onClick={() => setExpandedRegistrar(expandedRegistrar === reg.name ? null : reg.name)}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-[11px] text-gray-700 hover:bg-gray-50"
                          >
                            <span className="font-medium">{reg.name}</span>
                            <svg className={`w-3 h-3 transition-transform ${expandedRegistrar === reg.name ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                          </button>
                          {expandedRegistrar === reg.name && (
                            <p className="px-3 pb-2 text-[10px] text-gray-500">{reg.steps}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Idle: domain input form ── */}
            {(!activeDomain && domainStatus !== "adding") && (
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
                    disabled={!domainInput.trim()}
                    className="bg-green-600 text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-green-700 transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    Go Live
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

            {/* Adding state */}
            {domainStatus === "adding" && (
              <div className="flex items-center gap-2 py-3">
                <svg className="w-4 h-4 text-zing-teal animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs text-gray-600">Creating Cloudflare zone and scanning DNS...</span>
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

          {/* ── IMAGE LIBRARY (collapsible) ── */}
          <div className="mt-4 border-t border-gray-200 pt-3">
            <button
              onClick={() => { const next = !showLibrary; setShowLibrary(next); if (next && libraryImages.length === 0 && !libraryLoading) fetchLibrary(); }}
              className="flex items-center justify-between w-full text-sm font-semibold text-zing-dark mb-2"
            >
              <span>Image Library</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={(e) => { e.stopPropagation(); libraryUploadRef.current?.click(); }}
                  className="text-gray-400 hover:text-zing-teal transition-colors p-0.5"
                  title="Upload image"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </button>
                <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showLibrary ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
              </div>
            </button>
            <input ref={libraryUploadRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleLibraryUpload(f); e.target.value = ""; }} />

            {showLibrary && (
              <div>
                {libraryLoading && <p className="text-xs text-gray-400 py-2">Loading...</p>}
                {libraryUploading && <p className="text-xs text-zing-teal py-1">Uploading...</p>}
                {libraryCopied && <p className="text-xs text-green-600 py-1">URL copied!</p>}

                {!libraryLoading && libraryImages.length === 0 && (
                  <div className="text-center py-6">
                    <p className="text-xs text-gray-400 mb-2">No images yet</p>
                    <button onClick={() => libraryUploadRef.current?.click()} className="text-xs bg-zing-teal text-white px-3 py-1.5 rounded hover:bg-zing-dark transition-colors">Upload</button>
                  </div>
                )}

                {libraryImages.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {libraryImages.map(img => (
                      <div key={img.name} className="relative group rounded-md overflow-hidden cursor-pointer" style={{ height: 80 }}>
                        <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                          <button
                            onClick={() => {
                              if (selectedImg) {
                                const iframeWin = iframeRef.current?.contentWindow;
                                if (iframeWin) iframeWin.postMessage({ type: "PIXEL_SET_IMAGE_URL", rawSrc: selectedImg.rawSrc, kind: selectedImg.kind, newSrc: img.url }, "*");
                              } else {
                                navigator.clipboard.writeText(img.url);
                                setLibraryCopied(img.name);
                                setTimeout(() => setLibraryCopied(null), 2000);
                              }
                            }}
                            title="Insert into page"
                            className="bg-white/90 text-zing-dark rounded-full w-7 h-7 flex items-center justify-center hover:bg-white transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M12 4v16m0-16l-4 4m4-4l4 4" /></svg>
                          </button>
                          <button
                            onClick={() => deleteLibraryImage(img.name)}
                            title="Delete"
                            className="bg-white/90 text-red-500 rounded-full w-7 h-7 flex items-center justify-center hover:bg-white transition-colors"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          </div>{/* end scrollable content */}
        </div>{/* end left sidebar */}

        {/* Divider */}
        <div className="w-px bg-gray-200 shrink-0" />

        {/* Right: Tabbed Chat / Preview */}
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">

          {/* Page selector bar */}
          <div className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 border-b border-gray-200 overflow-x-auto shrink-0">
            {(showAllPages ? pages : pages.filter(p => p.isNav !== false)).map((p) => (
              <button
                key={p.filename}
                onClick={() => {
                  setCurrentPage(p.filename);
                  setBlobUrl(null);
                  setLocationPreview(null);
                  setSeoData(null);
                  setImgList([]);
                  setChatMessages([]);
                  setSectionAction(null);
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
            {/* Subpage toggle — only shown when site has non-nav pages (migrated sites) */}
            {hasSubpages && (
              <button
                onClick={() => setShowAllPages(v => !v)}
                className="ml-auto pl-2 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-gray-400 hover:text-gray-600 whitespace-nowrap border-l border-gray-200 shrink-0"
                title={showAllPages ? "Hide internal subpages" : `Show all ${pages.length} pages including internal subpages`}
              >
                {showAllPages ? "Nav only" : `+${pages.filter(p => !p.isNav).length} more`}
              </button>
            )}
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
                  loadInteractivePreview();
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

            {/* Device toggle + Add Widget — only when on Preview tab */}
            {rightTab === "preview" && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const next = !widgetMode;
                    setWidgetMode(next);
                    const iframeWin = iframeRef.current?.contentWindow;
                    if (iframeWin) iframeWin.postMessage({ type: "PIXEL_WIDGET_MODE", on: next }, "*");
                  }}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    widgetMode
                      ? "bg-zing-teal text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  Add Widget
                </button>
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
                              onClick={() => setShowSidebarFontPicker(p => !p)}
                              className={`text-xs px-2 py-0.5 rounded-full font-semibold border transition-colors ${
                                showSidebarFontPicker
                                  ? "bg-zing-teal text-white border-zing-teal"
                                  : "border-gray-300 text-gray-600 hover:border-zing-teal hover:text-zing-teal"
                              }`}
                            >
                              Aa {currentFont ? `· ${currentFont}` : ""}
                            </button>
                            {showSidebarFontPicker && (
                              <FontPicker
                                currentFont={currentFont}
                                onSelect={applyFont}
                                onClose={() => setShowSidebarFontPicker(false)}
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
                      {!blobUrl && (site.live_url || site.preview_url) && (
                        <a
                          href={site.live_url || site.preview_url || ""}
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

                    {/* Link edit popover */}
                    {/* Right-click context menu */}
                    {sectionAction && (
                      <div
                        data-pixel-popover="1"
                        style={{
                          position: 'fixed',
                          top: Math.min(sectionAction.mouseY, window.innerHeight - 120),
                          left: Math.min(sectionAction.mouseX, window.innerWidth - 200),
                          zIndex: 2147483645,
                          background: 'white',
                          borderRadius: 8,
                          boxShadow: '0 4px 20px rgba(0,0,0,0.14)',
                          border: '1px solid #e5e7eb',
                          padding: '4px',
                          minWidth: 180,
                        }}
                      >
                        {sectionAction.isHidden ? (
                          <button
                            onClick={() => toggleSection(false)}
                            className="w-full text-[12px] text-left px-3 py-2 rounded hover:bg-gray-50 text-gray-700"
                          >
                            Show section
                          </button>
                        ) : (
                          <button
                            onClick={() => toggleSection(true)}
                            className="w-full text-[12px] text-left px-3 py-2 rounded hover:bg-gray-50 text-gray-700"
                          >
                            Hide section
                          </button>
                        )}
                        <div className="w-full h-px bg-gray-100 my-1" />
                        <button
                          onClick={() => setSectionAction(null)}
                          className="w-full text-[12px] text-left px-3 py-2 rounded hover:bg-gray-50 text-gray-400"
                        >
                          Cancel
                        </button>
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
          {(site.live_url || site.preview_url) ? (
            <a
              href={site.live_url || site.preview_url || ""}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-zing-teal hover:underline truncate max-w-[220px]"
            >
              {site.live_url || site.preview_url}
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

      {/* Widget picker modal */}
      {widgetPickerOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setWidgetPickerOpen(false); setWidgetMode(false); const iw = iframeRef.current?.contentWindow; if (iw) iw.postMessage({ type: "PIXEL_WIDGET_MODE", on: false }, "*"); }}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zing-dark mb-4">Add Widget</h3>
            <div className="grid grid-cols-2 gap-3">
              {([
                { type: "text", label: "Text Block", icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h10M4 18h14" /></svg> },
                { type: "heading", label: "Heading", icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M4 6h16M4 12h16" /><text x="8" y="20" fontSize="8" fill="currentColor" fontWeight="bold">H</text></svg> },
                { type: "gallery", label: "Gallery", icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} /><rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} /><rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} /><rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2} /></svg> },
                { type: "divider", label: "Divider", icon: <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M4 12h16" /></svg> },
              ] as const).map((w) => (
                <button
                  key={w.type}
                  onClick={() => insertWidget(w.type)}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-gray-200 hover:border-zing-teal hover:bg-zing-teal/5 transition-colors text-gray-600 hover:text-zing-teal"
                >
                  {w.icon}
                  <span className="text-xs font-medium">{w.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Link destination picker modal */}
      {linkDestOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setLinkDestOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-zing-dark mb-4">Link Destination</h3>
            <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1">
              {(["page", "anchor", "external", "contact"] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => { setLinkDestTab(tab); setLinkDestValue(""); }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${linkDestTab === tab ? "bg-white text-zing-teal shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                >
                  {tab === "page" ? "Page" : tab === "anchor" ? "Anchor" : tab === "external" ? "External" : "Contact"}
                </button>
              ))}
            </div>

            <div className="min-h-[160px] max-h-[240px] overflow-y-auto mb-4">
              {linkDestTab === "page" && (
                <div className="space-y-1">
                  {pages.map(p => (
                    <button
                      key={p.filename}
                      onClick={() => setLinkDestValue(p.isHome ? "/" : `/${p.slug}/`)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${linkDestValue === (p.isHome ? "/" : `/${p.slug}/`) ? "bg-zing-teal/10 text-zing-teal font-medium" : "hover:bg-gray-50 text-gray-700"}`}
                    >
                      {p.isHome ? "Home (/)" : `/${p.slug}/`}
                    </button>
                  ))}
                </div>
              )}

              {linkDestTab === "anchor" && (() => {
                const anchors: string[] = [];
                const html = localPages[currentPage] || "";
                const re = /\sid="([^"]+)"/g;
                let m: RegExpExecArray | null;
                while ((m = re.exec(html)) !== null) anchors.push(m[1]);
                return (
                  <div className="space-y-1">
                    {anchors.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">No anchors found on this page.</p>}
                    {anchors.map(id => (
                      <button
                        key={id}
                        onClick={() => setLinkDestValue(`#${id}`)}
                        className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${linkDestValue === `#${id}` ? "bg-zing-teal/10 text-zing-teal font-medium" : "hover:bg-gray-50 text-gray-700"}`}
                      >
                        #{id}
                      </button>
                    ))}
                  </div>
                );
              })()}

              {linkDestTab === "external" && (
                <div className="py-2">
                  <input
                    type="url"
                    value={linkDestValue}
                    onChange={e => setLinkDestValue(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                </div>
              )}

              {linkDestTab === "contact" && (
                <div className="space-y-3 py-2">
                  <div className="flex gap-3">
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" checked={linkContactType === "tel"} onChange={() => { setLinkContactType("tel"); setLinkDestValue(""); }} className="accent-zing-teal" /> Phone
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                      <input type="radio" checked={linkContactType === "mailto"} onChange={() => { setLinkContactType("mailto"); setLinkDestValue(""); }} className="accent-zing-teal" /> Email
                    </label>
                  </div>
                  <input
                    type={linkContactType === "tel" ? "tel" : "email"}
                    value={linkDestValue.replace(/^(tel:|mailto:)/, "")}
                    onChange={e => setLinkDestValue(`${linkContactType}:${e.target.value}`)}
                    placeholder={linkContactType === "tel" ? "+1 (555) 123-4567" : "hello@example.com"}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={() => setLinkDestOpen(false)} className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
              <button
                onClick={() => {
                  const iframeWin = iframeRef.current?.contentWindow;
                  if (iframeWin && linkDestValue) {
                    iframeWin.postMessage({ type: "PIXEL_SET_LINK", originalHtml: linkDestOrigHtml, href: linkDestValue }, "*");
                    setDirtyPages(d => new Set([...d, currentPage]));
                  }
                  setLinkDestOpen(false);
                }}
                disabled={!linkDestValue}
                className="flex-1 bg-zing-teal text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
              >
                Save
              </button>
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
