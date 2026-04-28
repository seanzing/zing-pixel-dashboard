"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Site {
  id: string;
  business_name: string;
  status: string;
  preview_url: string | null;
  live_url: string | null;
  updated_at: string;
  funnel: string | null;
  surge_session_id: string | null;
}

type StatusFilter = "all" | "preview" | "live" | "archived";
type SourceFilter = "all" | "surge" | "frame";

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "preview", label: "Preview" },
  { key: "live", label: "Live" },
  { key: "archived", label: "Archived" },
];

const SOURCE_TABS: { key: SourceFilter; label: string; icon: string }[] = [
  { key: "all", label: "All Sites", icon: "🌐" },
  { key: "surge", label: "Surge", icon: "⚡" },
  { key: "frame", label: "Frame", icon: "🖼️" },
];

export default function DashboardPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const router = useRouter();

  async function fetchSites() {
    try {
      const res = await fetch("/api/sites", { cache: "no-store" });
      const data = await res.json();
      setSites(data.sites ?? []);
    } catch (err) {
      console.error("fetchSites error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSites();
  }, []);

  async function handleArchive(siteId: string) {
    await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });
    setArchivingId(null);
    await fetchSites();
  }

  async function handleUnarchive(siteId: string) {
    await fetch(`/api/sites/${siteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "preview" }),
    });
    await fetchSites();
  }

  const isSurge = (s: Site) => !!(s.funnel || s.surge_session_id);

  const sourceFilteredSites = sourceFilter === "all"
    ? sites
    : sourceFilter === "surge"
    ? sites.filter(isSurge)
    : sites.filter((s) => !isSurge(s));

  const counts = {
    all: sourceFilteredSites.filter((s) => s.status !== "archived").length,
    preview: sourceFilteredSites.filter((s) => s.status === "preview").length,
    live: sourceFilteredSites.filter((s) => s.status === "live").length,
    archived: sourceFilteredSites.filter((s) => s.status === "archived").length,
  };

  const sourceCounts = {
    all: sites.length,
    surge: sites.filter(isSurge).length,
    frame: sites.filter((s) => !isSurge(s)).length,
  };

  const visibleSites = sourceFilteredSites.filter((s) => {
    const matchesStatus =
      statusFilter === "all" ? s.status !== "archived" : s.status === statusFilter;
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      s.business_name.toLowerCase().includes(q) ||
      s.id.toLowerCase().includes(q);
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="h-full overflow-y-auto">
    <div className="p-8">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-2xl font-bold text-zing-dark">Sites</h2>
        <button
          onClick={() => setShowModal(true)}
          className="bg-zing-teal text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors"
        >
          + Add Site
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center justify-between mb-5 gap-4">
        {/* Source filter (Surge / Frame) */}
        <div className="flex gap-2 mb-4">
          {SOURCE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => { setSourceFilter(tab.key); setStatusFilter("all"); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                sourceFilter === tab.key
                  ? "bg-zing-teal text-white"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                sourceFilter === tab.key ? "bg-white/20 text-white" : "bg-white text-gray-500"
              }`}>
                {sourceCounts[tab.key]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex gap-1 border-b border-gray-200 flex-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-3 py-2 text-sm font-medium transition-colors relative whitespace-nowrap ${
                statusFilter === tab.key
                  ? "text-zing-teal border-b-2 border-zing-teal -mb-px"
                  : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                statusFilter === tab.key ? "bg-zing-teal/10 text-zing-teal" : "bg-gray-100 text-gray-500"
              }`}>
                {counts[tab.key]}
              </span>
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Search sites..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 border border-gray-200 rounded-md text-sm w-52 focus:outline-none focus:ring-2 focus:ring-zing-teal"
        />
      </div>

      {loading ? (
        <p className="text-gray-500 text-sm">Loading...</p>
      ) : visibleSites.length === 0 ? (
        <p className="text-gray-500 text-sm">
          {search ? `No sites matching "${search}"` : "No sites yet. Add your first site."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {visibleSites.map((site) => {
            const isArchived = site.status === "archived";
            return (
              <div
                key={site.id}
                className={`bg-white rounded-lg border border-gray-200 p-5 shadow-sm group relative ${
                  isArchived ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-lg text-zing-dark">
                      {site.business_name}
                    </h3>
                    <p className="text-xs text-gray-400">{site.id}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span
                      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        isArchived
                          ? "bg-gray-100 text-gray-500"
                          : site.status === "live"
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {isArchived ? "Archived" : site.status === "live" ? "Live" : "Preview"}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400">
                      {isSurge(site) ? "⚡ Surge" : "🖼️ Frame"}
                    </span>
                  </div>
                </div>

                {(site.live_url || site.preview_url) && (
                  <a
                    href={site.live_url || site.preview_url || ""}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zing-teal hover:underline break-all"
                  >
                    {site.live_url || site.preview_url}
                  </a>
                )}

                <p className="text-xs text-gray-400 mt-2">
                  Updated{" "}
                  {new Date(site.updated_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => router.push(`/dashboard/sites/${site.id}`)}
                    className="flex-1 text-center bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-sm hover:bg-gray-200 transition-colors"
                  >
                    Edit
                  </button>

                  {isArchived ? (
                    <button
                      onClick={() => handleUnarchive(site.id)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
                    >
                      Unarchive
                    </button>
                  ) : archivingId === site.id ? (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-500">Archive?</span>
                      <button
                        onClick={() => handleArchive(site.id)}
                        className="text-xs text-red-600 hover:text-red-800 px-1"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setArchivingId(null)}
                        className="text-xs text-gray-400 hover:text-gray-600 px-1"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setArchivingId(site.id)}
                      className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded opacity-0 group-hover:opacity-100 hover:bg-gray-100 transition-all"
                      title="Archive site"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showModal && (
        <AddSiteModal
          onClose={() => setShowModal(false)}
          onCreated={(id) => {
            setShowModal(false);
            router.push(`/dashboard/sites/${id}`);
          }}
        />
      )}
    </div>
    </div>
  );
}

function AddSiteModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState({
    id: "",
    business_name: "",
    owner_email: "",
    phone: "",
    address: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [htmlFile, setHtmlFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    // Step 1: Create the site record + starter index.html in GitHub
    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create site");
      setSaving(false);
      return;
    }

    const data = await res.json();
    const siteId = data.site.id;

    // Step 2: If an HTML file was uploaded, overwrite the starter index.html
    if (htmlFile) {
      try {
        const html = await htmlFile.text();
        // Poll until GitHub has the starter file (needed for SHA)
        let fileReady = false;
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 800));
          const check = await fetch(`/api/sites/${siteId}/pages`);
          if (check.ok) { fileReady = true; break; }
        }
        if (!fileReady) console.warn("GitHub starter file not ready after retries");
        const deployRes = await fetch(`/api/sites/${siteId}/deploy-html`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            html,
            page: "index.html",
            commitMessage: `init(${siteId}): upload HTML from file`,
          }),
        });
        if (!deployRes.ok) {
          const deployData = await deployRes.json();
          // Non-fatal — site is created, HTML upload just failed
          console.warn("HTML upload failed:", deployData.error);
        }
      } catch (err) {
        console.warn("HTML upload error:", err);
      }
    }

    onCreated(siteId);
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
        <h3 className="text-lg font-semibold text-zing-dark mb-4">
          Add New Site
        </h3>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Site ID (slug)
            </label>
            <input
              type="text"
              value={form.id}
              onChange={(e) =>
                setForm({ ...form, id: e.target.value.replace(/\s/g, "") })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
              placeholder="e.g. mooreroofing"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Business Name
            </label>
            <input
              type="text"
              value={form.business_name}
              onChange={(e) =>
                setForm({ ...form, business_name: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Owner Email
            </label>
            <input
              type="email"
              value={form.owner_email}
              onChange={(e) =>
                setForm({ ...form, owner_email: e.target.value })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Phone
            </label>
            <input
              type="text"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Address
            </label>
            <input
              type="text"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-zing-teal"
            />
          </div>

          {/* HTML file upload — optional */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Upload HTML File <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".html,.htm"
              className="hidden"
              onChange={(e) => setHtmlFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-3 py-2 border-2 border-dashed border-gray-300 rounded-md text-sm text-gray-500 hover:border-zing-teal hover:text-zing-teal transition-colors text-left flex items-center gap-2"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              {htmlFile ? (
                <span className="text-zing-teal font-medium truncate">{htmlFile.name}</span>
              ) : (
                <span>Click to upload an HTML file from Claude Design or similar</span>
              )}
            </button>
            {htmlFile && (
              <button
                type="button"
                onClick={() => { setHtmlFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                className="mt-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
              >
                Remove file
              </button>
            )}
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 bg-zing-teal text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
            >
              {saving ? (htmlFile ? "Uploading HTML…" : "Creating…") : "Create Site"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
