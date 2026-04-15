"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface AvailableSite {
  id: string;
  selected: boolean;
}

interface ImportResult {
  id: string;
  status: "imported" | "error";
  business_name?: string;
  error?: string;
}

export default function ImportPage() {
  const [available, setAvailable] = useState<AvailableSite[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [ownerEmail, setOwnerEmail] = useState("publishing@zing-work.com");
  const [results, setResults] = useState<ImportResult[]>([]);
  const [stats, setStats] = useState<{ totalAvailable: number; totalInCatalog: number; registered: number } | null>(null);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const router = useRouter();

  async function fetchAvailable(q = "") {
    setLoading(true);
    setResults([]);
    try {
      const res = await fetch(`/api/import/available${q ? `?search=${encodeURIComponent(q)}` : ""}`);
      const data = await res.json();
      setAvailable((data.available ?? []).map((id: string) => ({ id, selected: false })));
      setStats({ totalAvailable: data.totalAvailable, totalInCatalog: data.totalInCatalog, registered: data.registered });
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  // Don't auto-load — 17k sites, let user search first
  useEffect(() => {
    // Load an empty search to show stats without sites
    fetch("/api/import/available?search=NOMATCH_INIT__")
      .then(r => r.json())
      .then(data => setStats({ totalAvailable: data.totalAvailable ?? 0, totalInCatalog: data.totalInCatalog ?? 0, registered: data.registered ?? 0 }))
      .catch(() => {});
  }, []);

  function toggleAll(checked: boolean) {
    setAvailable((prev) => prev.map((s) => ({ ...s, selected: checked })));
  }

  function toggle(id: string) {
    setAvailable((prev) =>
      prev.map((s) => (s.id === id ? { ...s, selected: !s.selected } : s))
    );
  }

  async function handleImport() {
    const selected = available.filter((s) => s.selected).map((s) => s.id);
    if (selected.length === 0) return;

    setImporting(true);
    setResults([]);

    try {
      const res = await fetch("/api/import/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteIds: selected, ownerEmail }),
      });
      const data = await res.json();
      setResults(data.results ?? []);
      // Refresh available list after import
      await fetchAvailable();
    } catch {
      // ignore
    } finally {
      setImporting(false);
    }
  }

  const selectedCount = available.filter((s) => s.selected).length;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-sm font-semibold text-zing-dark">Import Sites</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              Search the demo catalog ({stats?.totalInCatalog?.toLocaleString() ?? "…"} sites) to find and import into Pixel
            </p>
          </div>
          {stats && (
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span><span className="font-semibold text-zing-dark">{stats.totalInCatalog?.toLocaleString()}</span> in catalog</span>
              <span><span className="font-semibold text-green-600">{stats.registered}</span> in Pixel</span>
              <span><span className="font-semibold text-amber-600">{stats.totalAvailable?.toLocaleString()}</span> available</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Main list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <p className="text-sm text-gray-400">Scanning GitHub...</p>
            </div>
          ) : available.length === 0 && !search ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <p className="text-sm font-medium text-gray-500">Search to find sites from the demo catalog</p>
              <p className="text-xs text-gray-400">Try a business name, vertical, or partial site ID</p>
              <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); fetchAvailable(searchInput); }} className="flex gap-2 mt-1">
                <input
                  value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  placeholder="e.g. roofing, denver, plumb..."
                  className="px-3 py-1.5 border border-gray-200 rounded text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-zing-teal w-64"
                  autoFocus
                />
                <button type="submit" className="bg-zing-teal text-white px-4 py-1.5 rounded text-xs font-semibold hover:bg-zing-dark transition-colors">
                  Search
                </button>
              </form>
            </div>
          ) : available.length === 0 && search ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2">
              <p className="text-sm font-medium text-gray-500">No results for &ldquo;{search}&rdquo;</p>
              <button onClick={() => { setSearch(""); setSearchInput(""); setAvailable([]); }} className="text-xs text-zing-teal hover:underline">Clear search</button>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="sticky top-0 bg-gray-50 border-b border-gray-200 px-6 py-2.5 flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={selectedCount === available.length && available.length > 0}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Select all ({available.length}{stats && stats.totalAvailable > available.length ? ` of ${stats.totalAvailable.toLocaleString()}` : ""})
                </label>

                <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); fetchAvailable(searchInput); }} className="flex gap-1.5">
                  <input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder="Search sites..."
                    className="px-2.5 py-1 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-zing-teal w-44"
                  />
                  <button type="submit" className="bg-gray-100 text-gray-700 px-3 py-1 rounded text-xs font-medium hover:bg-gray-200">Search</button>
                  {search && <button type="button" onClick={() => { setSearch(""); setSearchInput(""); setAvailable([]); }} className="text-xs text-gray-400 hover:text-gray-600">✕</button>}
                </form>

                <div className="flex items-center gap-2 ml-auto">
                  <label className="text-xs text-gray-500">Default owner email</label>
                  <input
                    type="email"
                    value={ownerEmail}
                    onChange={(e) => setOwnerEmail(e.target.value)}
                    className="px-2.5 py-1 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-2 focus:ring-zing-teal w-56"
                    placeholder="publishing@zing-work.com"
                  />
                </div>

                <button
                  onClick={handleImport}
                  disabled={importing || selectedCount === 0}
                  className="bg-zing-teal text-white px-4 py-1.5 rounded text-xs font-semibold hover:bg-zing-dark transition-colors disabled:opacity-50"
                >
                  {importing
                    ? "Importing..."
                    : `Import ${selectedCount} site${selectedCount !== 1 ? "s" : ""}`}
                </button>
              </div>

              {/* Site list */}
              <div className="divide-y divide-gray-100">
                {available.map((site) => {
                  const result = results.find((r) => r.id === site.id);
                  return (
                    <div
                      key={site.id}
                      className={`flex items-center gap-4 px-6 py-3 hover:bg-gray-50 ${
                        result?.status === "imported" ? "bg-green-50" : ""
                      } ${result?.status === "error" ? "bg-red-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={site.selected}
                        onChange={() => toggle(site.id)}
                        disabled={!!result}
                        className="rounded border-gray-300"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-zing-dark truncate">
                          {result?.business_name ?? site.id}
                        </p>
                        <p className="text-xs text-gray-400">{site.id}</p>
                      </div>
                      {result?.status === "imported" && (
                        <span className="text-xs text-green-600 font-medium shrink-0">✓ Imported</span>
                      )}
                      {result?.status === "error" && (
                        <span className="text-xs text-red-500 truncate max-w-xs shrink-0" title={result.error}>
                          ✗ {result.error}
                        </span>
                      )}
                      {!result && (
                        <button
                          onClick={() => {
                            setAvailable((prev) =>
                              prev.map((s) => ({ ...s, selected: s.id === site.id }))
                            );
                          }}
                          className="text-xs text-gray-400 hover:text-zing-teal shrink-0"
                        >
                          Select only
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Results summary panel */}
        {results.length > 0 && (
          <div className="w-64 shrink-0 border-l border-gray-200 bg-white p-5 overflow-y-auto">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
              Import Results
            </h3>
            <div className="space-y-1 mb-4">
              <p className="text-sm">
                <span className="font-semibold text-green-600">
                  {results.filter((r) => r.status === "imported").length}
                </span>{" "}
                <span className="text-gray-600">imported</span>
              </p>
              {results.filter((r) => r.status === "error").length > 0 && (
                <p className="text-sm">
                  <span className="font-semibold text-red-500">
                    {results.filter((r) => r.status === "error").length}
                  </span>{" "}
                  <span className="text-gray-600">failed</span>
                </p>
              )}
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="w-full bg-zing-teal text-white py-1.5 rounded text-xs font-semibold hover:bg-zing-dark transition-colors"
            >
              View in Sites →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
