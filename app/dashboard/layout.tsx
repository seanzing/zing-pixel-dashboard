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
    <div className="min-h-screen flex">
      <aside className="w-60 bg-zing-dark text-white flex flex-col shrink-0">
        <div className="p-5 border-b border-white/10">
          <h1 className="text-xl font-bold">ZING</h1>
          <p className="text-xs text-zing-light-teal mt-0.5">Pixel Dashboard</p>
        </div>

        <nav className="flex-1 p-3">
          <Link
            href="/dashboard"
            className="block px-3 py-2 rounded text-sm hover:bg-white/10 transition-colors"
          >
            Sites
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
      </aside>

      <main className="flex-1 bg-zing-cream overflow-auto">{children}</main>
    </div>
  );
}
