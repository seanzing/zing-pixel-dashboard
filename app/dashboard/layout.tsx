"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [email, setEmail] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push("/login");
      } else {
        setEmail(user.email ?? null);
      }
    });
  }, [router, supabase]);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <aside
        className={`bg-zing-dark text-white flex flex-col shrink-0 transition-all duration-200 ${
          collapsed ? "w-12" : "w-56"
        }`}
      >
        <div className={`border-b border-white/10 flex items-center ${collapsed ? "p-3 justify-center" : "p-4 justify-between"}`}>
          {!collapsed && (
            <div>
              <h1 className="text-lg font-bold leading-tight">ZING</h1>
              <p className="text-xs text-zing-light-teal">Pixel</p>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-white/50 hover:text-white transition-colors p-1 rounded"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>

        {!collapsed && (
          <>
            <nav className="flex-1 p-3 space-y-0.5">
              <Link
                href="/dashboard"
                className="flex items-center gap-2.5 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
              >
                <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                Sites
              </Link>
              <Link
                href="/dashboard/import"
                className="flex items-center gap-2.5 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors text-white/70 hover:text-white"
              >
                <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import
              </Link>
              <div className="border-t border-white/10 my-2" />
              <Link
                href="/dashboard/health"
                className="flex items-center gap-2.5 px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors text-white/70 hover:text-white"
              >
                <svg className="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Health
              </Link>
            </nav>

            <div className="p-4 border-t border-white/10">
              <p className="text-xs text-zing-light-teal truncate">{email}</p>
              <button
                onClick={handleLogout}
                className="text-xs text-gray-400 hover:text-white mt-1 transition-colors"
              >
                Sign out
              </button>
            </div>
          </>
        )}

        {collapsed && (
          <nav className="flex-1 p-2 flex flex-col items-center gap-2 mt-2">
            <Link href="/dashboard" className="p-2 rounded hover:bg-white/10 transition-colors" title="Sites">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </Link>
            <Link href="/dashboard/import" className="p-2 rounded hover:bg-white/10 transition-colors" title="Import">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
            </Link>
            <div className="w-5 border-t border-white/10" />
            <Link href="/dashboard/health" className="p-2 rounded hover:bg-white/10 transition-colors" title="Health">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </Link>
          </nav>
        )}
      </aside>

      <main className="flex-1 bg-zing-cream overflow-hidden h-full">{children}</main>
    </div>
  );
}
