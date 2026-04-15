"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface HealthData {
  statusCounts: Record<string, number>;
  totalSites: number;
  deployments: { total: number; success: number; failed: number; successRate: number | null };
  staleLiveSites: Array<{ id: string; business_name: string; updated_at: string }>;
  topEdited: Array<{ id: string; business_name: string; edits: number }>;
  previewOnlySites: Array<{ id: string; business_name: string; updated_at: string }>;
  recentDeploys: Array<{
    id: string; site_id: string; business_name: string;
    type: string; status: string; deployed_at: string; deployed_by: string | null;
  }>;
  editCount30d: number;
}

function StatCard({ label, value, sub, color = "text-zing-dark" }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function HealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading health data...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-red-400">Failed to load health data.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-sm font-semibold text-zing-dark">Platform Health</h1>
          <p className="text-xs text-gray-400 mt-0.5">Last 30 days · {data.totalSites} total sites</p>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="Total Sites"
            value={data.totalSites}
            sub={`${data.statusCounts.live ?? 0} live · ${data.statusCounts.preview ?? 0} preview`}
          />
          <StatCard
            label="Deploy Success Rate"
            value={data.deployments.successRate !== null ? `${data.deployments.successRate}%` : "—"}
            sub={`${data.deployments.success} success · ${data.deployments.failed} failed`}
            color={
              data.deployments.successRate === null
                ? "text-gray-400"
                : data.deployments.successRate >= 90
                ? "text-green-600"
                : data.deployments.successRate >= 70
                ? "text-amber-600"
                : "text-red-600"
            }
          />
          <StatCard
            label="Edits (30d)"
            value={data.editCount30d}
            sub="AI editor activity"
          />
          <StatCard
            label="Stale Live Sites"
            value={data.staleLiveSites.length}
            sub="Live with no deploy in 30d"
            color={data.staleLiveSites.length > 0 ? "text-amber-600" : "text-green-600"}
          />
        </div>

        {/* Two-col layout */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sites awaiting go-live */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Preview Only — Not Yet Live
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.previewOnlySites.length === 0 ? (
                <p className="px-4 py-4 text-xs text-gray-400">All sites are live 🎉</p>
              ) : (
                data.previewOnlySites.map((s) => (
                  <Link
                    key={s.id}
                    href={`/dashboard/sites/${s.id}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 group"
                  >
                    <span className="text-sm text-zing-dark group-hover:text-zing-teal truncate">
                      {s.business_name}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0 ml-2">
                      {relativeTime(s.updated_at)}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Most active sites */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Most Edited (30d)
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.topEdited.length === 0 ? (
                <p className="px-4 py-4 text-xs text-gray-400">No AI edits recorded yet.</p>
              ) : (
                data.topEdited.map((s) => (
                  <Link
                    key={s.id}
                    href={`/dashboard/sites/${s.id}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 group"
                  >
                    <span className="text-sm text-zing-dark group-hover:text-zing-teal truncate">
                      {s.business_name}
                    </span>
                    <span className="text-xs font-semibold text-zing-teal shrink-0 ml-2">
                      {s.edits} edits
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Recent deploys */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Recent Deploys
              </h2>
            </div>
            <div className="divide-y divide-gray-50">
              {data.recentDeploys.length === 0 ? (
                <p className="px-4 py-4 text-xs text-gray-400">No deployments yet.</p>
              ) : (
                data.recentDeploys.map((d) => (
                  <div key={d.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        d.status === "success" ? "bg-green-500" : "bg-red-400"
                      }`}
                    />
                    <Link
                      href={`/dashboard/sites/${d.site_id}`}
                      className="text-sm text-zing-dark hover:text-zing-teal truncate flex-1"
                    >
                      {d.business_name}
                    </Link>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                        d.type === "production"
                          ? "bg-zing-teal/10 text-zing-teal"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {d.type}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {relativeTime(d.deployed_at)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Stale live sites */}
          {data.staleLiveSites.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-amber-100 bg-amber-50">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                  Live — No Recent Deploys
                </h2>
              </div>
              <div className="divide-y divide-gray-50">
                {data.staleLiveSites.map((s) => (
                  <Link
                    key={s.id}
                    href={`/dashboard/sites/${s.id}`}
                    className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 group"
                  >
                    <span className="text-sm text-zing-dark group-hover:text-zing-teal truncate">
                      {s.business_name}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0 ml-2">
                      Last updated {relativeTime(s.updated_at)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
