"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import googleFonts from "@/data/google-fonts.json";

type FontEntry = { family: string; category: string };
type Category = "all" | "sans-serif" | "serif" | "display" | "handwriting" | "monospace";

const CATEGORY_LABELS: Record<Category, string> = {
  all: "All",
  "sans-serif": "Sans-serif",
  serif: "Serif",
  display: "Display",
  handwriting: "Handwriting",
  monospace: "Mono",
};

// Load a font's preview CSS via Google Fonts text= trick (minimal payload)
const loadedPreviews = new Set<string>();
function loadFontPreview(family: string) {
  if (loadedPreviews.has(family)) return;
  loadedPreviews.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}&text=${encodeURIComponent(family + "Aa")}&display=swap`;
  document.head.appendChild(link);
}

interface Props {
  currentFont?: string;
  onSelect: (family: string, linkHref: string) => void;
  onClose: () => void;
}

export default function FontPicker({ currentFont, onSelect, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const fonts = googleFonts as FontEntry[];

  const filtered = fonts.filter((f) => {
    const matchCat = category === "all" || f.category === category;
    const matchSearch = search === "" || f.family.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  // Close on outside click
  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  // Focus search on mount
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Lazy-load font previews using IntersectionObserver
  const observerRef = useRef<IntersectionObserver | null>(null);
  const rowCallback = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const family = (entry.target as HTMLElement).dataset.family;
              if (family) loadFontPreview(family);
            }
          });
        },
        { rootMargin: "100px" }
      );
    }
    observerRef.current.observe(node);
  }, []);

  function handleSelect(family: string) {
    const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
    onSelect(family, href);
    onClose();
  }

  return (
    <div
      ref={containerRef}
      className="bg-white rounded-xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden"
      style={{ width: 280, maxHeight: 420, position: "relative" }}
    >
      {/* Search */}
      <div className="p-2 border-b border-gray-100">
        <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
          <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" viewBox="0 0 16 16">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="m11 11 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fonts..."
            className="bg-transparent text-xs w-full outline-none text-gray-700 placeholder-gray-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600 text-xs leading-none">✕</button>
          )}
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-0.5 px-2 py-1.5 border-b border-gray-100 overflow-x-auto">
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className={`text-[10px] font-semibold px-2 py-1 rounded-md whitespace-nowrap transition-colors ${
              category === cat
                ? "bg-zing-teal text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* Font list */}
      <div className="overflow-y-auto flex-1">
        {filtered.length === 0 ? (
          <div className="text-center text-gray-400 text-xs py-8">No fonts found</div>
        ) : (
          filtered.map((font) => (
            <div
              key={font.family}
              ref={rowCallback}
              data-family={font.family}
              onClick={() => handleSelect(font.family)}
              className={`flex items-center justify-between px-3 py-2.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                currentFont === font.family ? "bg-teal-50" : ""
              }`}
            >
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[10px] text-gray-400 leading-none">{font.family}</span>
                <span
                  className="text-base leading-tight text-gray-800 truncate"
                  style={{ fontFamily: `'${font.family}', ${font.category === "monospace" ? "monospace" : "sans-serif"}` }}
                >
                  {font.family}
                </span>
              </div>
              {currentFont === font.family && (
                <span className="text-zing-teal text-xs shrink-0 ml-2">✓</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
