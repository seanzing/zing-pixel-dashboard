"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";

interface Job {
  id: string;
  url: string;
  slug: string;
  name: string;
  status: "queued" | "running" | "done" | "error";
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: { pagesWritten: number; assetsDownloaded: number; siteId: string; previewUrl?: string } | null;
}

interface HistorySite {
  id: string;
  business_name: string;
  status: string;
  preview_url: string;
  created_at: string;
}

function slugFromUrl(url: string): string {
  try {
    const domain = new URL(url).hostname.replace(/^www\./, "");
    return domain
      .split(".")[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  } catch {
    return "";
  }
}

type Tab = "single" | "batch";

interface BatchRow {
  url: string;
  slug: string;
  name: string;
}

export default function MigratePage() {
  const [tab, setTab] = useState<Tab>("single");

  // Single mode
  const [url, setUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  // Batch mode
  const [batchText, setBatchText] = useState("");
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);

  // Jobs
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobLogs, setJobLogs] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const activeStreams = useRef<Set<string>>(new Set());

  // Past migrations from Supabase (survives worker restarts)
  const [history, setHistory] = useState<HistorySite[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  // Auto-slug from URL
  useEffect(() => {
    if (!slugEdited && url) {
      setSlug(slugFromUrl(url));
    }
  }, [url, slugEdited]);

  // Parse batch text into rows
  useEffect(() => {
    if (!batchText.trim()) {
      setBatchRows([]);
      return;
    }
    const lines = batchText
      .trim()
      .split("\n")
      .filter((l) => l.trim());
    if (lines.length === 0) {
      setBatchRows([]);
      return;
    }
    const isCSV = lines[0].includes(",");
    if (isCSV) {
      const dataLines =
        lines[0].toLowerCase().includes("url") ? lines.slice(1) : lines;
      setBatchRows(
        dataLines.map((line) => {
          const parts = line.split(",").map((s) => s.trim());
          return {
            url: parts[0] || "",
            slug: parts[1] || slugFromUrl(parts[0] || ""),
            name: parts[2] || "",
          };
        })
      );
    } else {
      setBatchRows(
        lines.map((line) => ({
          url: line.trim(),
          slug: slugFromUrl(line.trim()),
          name: "",
        }))
      );
    }
  }, [batchText]);

  // Poll jobs
  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/migrate/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 3000);
    return () => clearInterval(interval);
  }, [fetchJobs]);

  // Fetch migration history from Supabase
  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/migrate/history");
      if (res.ok) setHistory(await res.json());
    } catch {}
    finally { setHistoryLoading(false); }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Refresh history when a job finishes
  useEffect(() => {
    const hasDone = jobs.some(j => j.status === "done");
    if (hasDone) fetchHistory();
  }, [jobs, fetchHistory]);

  // Stream logs for running jobs
  useEffect(() => {
    const runningJobs = jobs.filter((j) => j.status === "running" || j.status === "queued");
    for (const job of runningJobs) {
      if (activeStreams.current.has(job.id)) continue;
      if (job.status !== "running") continue;
      activeStreams.current.add(job.id);

      const evtSource = new EventSource(`/api/migrate/${job.id}/stream`);
      evtSource.onmessage = (e) => {
        const line = e.data;
        if (line === "[DONE]" || line.startsWith("[ERROR]")) {
          evtSource.close();
          activeStreams.current.delete(job.id);
          fetchJobs();
          return;
        }
        setJobLogs((prev) => ({
          ...prev,
          [job.id]: [...(prev[job.id] || []), line].slice(-50),
        }));
      };
      evtSource.onerror = () => {
        evtSource.close();
        activeStreams.current.delete(job.id);
      };
    }
  }, [jobs, fetchJobs]);

  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url || !slug) return;
    setSubmitting(true);
    try {
      await fetch("/api/migrate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, slug, name }),
      });
      setUrl("");
      setSlug("");
      setName("");
      setSlugEdited(false);
      fetchJobs();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleBatchSubmit() {
    if (batchRows.length === 0) return;
    setSubmitting(true);
    try {
      await fetch("/api/migrate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sites: batchRows.map((r) => ({
            url: r.url,
            slug: r.slug,
            name: r.name,
          })),
        }),
      });
      setBatchText("");
      setBatchRows([]);
      fetchJobs();
    } finally {
      setSubmitting(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setBatchText(reader.result as string);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleRetry(job: Job) {
    await fetch("/api/migrate/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: job.url, slug: job.slug, name: job.name }),
    });
    fetchJobs();
  }

  function updateBatchRow(i: number, field: keyof BatchRow, value: string) {
    setBatchRows((prev) =>
      prev.map((row, idx) => (idx === i ? { ...row, [field]: value } : row))
    );
  }

  const statusColor: Record<string, string> = {
    queued: "bg-yellow-100 text-yellow-800",
    running: "bg-blue-100 text-blue-800",
    done: "bg-green-100 text-green-800",
    error: "bg-red-100 text-red-800",
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="text-2xl font-bold text-zing-dark mb-6">Migrate Sites</h1>

      {/* Tab selector */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {(["single", "batch"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === t
                ? "bg-white text-zing-dark shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "single" ? "Single" : "Batch"}
          </button>
        ))}
      </div>

      {/* Single mode */}
      {tab === "single" && (
        <form
          onSubmit={handleSingleSubmit}
          className="bg-white rounded-lg border border-gray-200 p-6 mb-8 max-w-xl"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source URL
              </label>
              <input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.example.com"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-zing-teal focus:border-zing-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Slug
              </label>
              <input
                type="text"
                required
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugEdited(true);
                }}
                placeholder="my-site"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-zing-teal focus:border-zing-teal"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Business Name{" "}
                <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp"
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-zing-teal focus:border-zing-teal"
              />
            </div>
            <button
              type="submit"
              disabled={submitting || !url || !slug}
              className="w-full px-4 py-2.5 bg-zing-teal text-white rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
            >
              {submitting ? "Starting..." : "Start Migration"}
            </button>
          </div>
        </form>
      )}

      {/* Batch mode */}
      {tab === "batch" && (
        <div className="bg-white rounded-lg border border-gray-200 p-6 mb-8">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Paste URLs (one per line) or CSV (url,slug,name)
            </label>
            <textarea
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              rows={6}
              placeholder={`https://www.site1.com\nhttps://www.site2.com\nhttps://www.site3.com\n\nOr CSV format:\nurl,slug,name\nhttps://www.site1.com,site1,Site One`}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:ring-2 focus:ring-zing-teal focus:border-zing-teal"
            />
            <div className="mt-2">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-zing-teal border border-zing-teal rounded-md cursor-pointer hover:bg-zing-teal/5 transition-colors">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                Upload .csv or .txt
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {/* Preview table */}
          {batchRows.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                Preview ({batchRows.length} sites)
              </h3>
              <div className="overflow-x-auto border border-gray-200 rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        URL
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Slug
                      </th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">
                        Name
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {batchRows.map((row, i) => (
                      <tr key={i}>
                        <td className="px-3 py-1.5 text-gray-600 max-w-xs truncate">
                          {row.url}
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={row.slug}
                            onChange={(e) =>
                              updateBatchRow(i, "slug", e.target.value)
                            }
                            className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <input
                            type="text"
                            value={row.name}
                            onChange={(e) =>
                              updateBatchRow(i, "name", e.target.value)
                            }
                            className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
                            placeholder="(optional)"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            onClick={handleBatchSubmit}
            disabled={submitting || batchRows.length === 0}
            className="px-4 py-2.5 bg-zing-teal text-white rounded-md text-sm font-medium hover:bg-zing-dark transition-colors disabled:opacity-50"
          >
            {submitting
              ? "Starting..."
              : `Start Batch Migration (${batchRows.length} sites)`}
          </button>
        </div>
      )}

      {/* Job queue */}
      <div>
        <h2 className="text-lg font-semibold text-zing-dark mb-3">
          Job Queue
        </h2>
        {jobs.length === 0 && (
          <p className="text-sm text-gray-500">No active jobs. Submit a URL above to start a migration. Completed migrations are shown below.</p>
        )}
        <div className="space-y-3">
          {jobs
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime()
            )
            .map((job) => (
              <div
                key={job.id}
                className="bg-white border border-gray-200 rounded-lg p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm text-zing-dark">
                      {job.slug}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        statusColor[job.status] || ""
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {job.status === "done" && (
                      <Link
                        href={`/dashboard/sites/${job.slug}`}
                        className="px-3 py-1 text-xs font-medium text-zing-teal border border-zing-teal rounded hover:bg-zing-teal/5 transition-colors"
                      >
                        Open in Editor
                      </Link>
                    )}
                    {job.status === "error" && (
                      <button
                        onClick={() => handleRetry(job)}
                        className="px-3 py-1 text-xs font-medium text-orange-600 border border-orange-300 rounded hover:bg-orange-50 transition-colors"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 truncate mb-1">
                  {job.url}
                </p>
                {job.error && (
                  <p className="text-xs text-red-600 mt-1">{job.error}</p>
                )}

                {/* Live logs */}
                {(job.status === "running" || (jobLogs[job.id]?.length ?? 0) > 0) && (
                  <LogPanel logs={jobLogs[job.id] || []} />
                )}
              </div>
            ))}
        </div>
      </div>

      {/* Past migrations — persisted in Supabase, survives worker restarts */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold text-zing-dark mb-3">
          Completed Migrations
          <span className="ml-2 text-sm font-normal text-gray-400">(from Supabase — survives restarts)</span>
        </h2>
        {historyLoading && <p className="text-sm text-gray-400">Loading...</p>}
        {!historyLoading && history.length === 0 && (
          <p className="text-sm text-gray-500">No completed migrations yet.</p>
        )}
        {!historyLoading && history.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Site</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Preview</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Created</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((site) => (
                  <tr key={site.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-zing-dark">{site.business_name || site.id}</div>
                      <div className="text-xs text-gray-400 font-mono">{site.id}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        site.status === "live" ? "bg-green-100 text-green-800" :
                        site.status === "draft" ? "bg-green-100 text-green-800" :
                        site.status === "migrating" ? "bg-blue-100 text-blue-800" :
                        site.status === "migration-error" ? "bg-red-100 text-red-800" :
                        "bg-gray-100 text-gray-600"
                      }`}>
                        {site.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <a
                        href={site.preview_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-zing-teal hover:underline truncate block max-w-xs"
                      >
                        {site.preview_url?.replace("https://", "")}
                      </a>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">
                      {new Date(site.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link
                        href={`/dashboard/sites/${site.id}`}
                        className="px-3 py-1 text-xs font-medium text-zing-teal border border-zing-teal rounded hover:bg-zing-teal/5 transition-colors"
                      >
                        Open in Editor
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function LogPanel({ logs }: { logs: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [logs]);

  const lastLines = logs.slice(-20);

  return (
    <div
      ref={ref}
      className="mt-3 bg-gray-900 text-green-400 text-xs font-mono p-3 rounded-md max-h-48 overflow-y-auto"
    >
      {lastLines.map((line, i) => (
        <div key={i} className="whitespace-pre-wrap leading-5">
          {line}
        </div>
      ))}
      {lastLines.length === 0 && (
        <div className="text-gray-500">Waiting for output...</div>
      )}
    </div>
  );
}
