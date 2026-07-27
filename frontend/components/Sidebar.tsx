"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

// Persistent table list so users can jump between tables' rules/results
// without going back to the home page each time - keeps the current table
// highlighted based on the URL alone.
export function Sidebar() {
  const pathname = usePathname();
  const [tables, setTables] = useState<{ name: string }[]>([]);

  useEffect(() => {
    api
      .listTables()
      .then((res) => setTables(res.tables))
      .catch(() => setTables([]));
  }, []);

  // Redundant with the home page's own table grid, and pointless before the
  // user has drilled into a specific table.
  if (tables.length === 0 || pathname === "/") return null;

  return (
    <aside className="hidden w-56 shrink-0 border-r bg-white/60 px-3 py-6 md:block">
      <Link
        href="/"
        className="mb-3 inline-flex items-center gap-1 px-2 text-sm text-blue-600 hover:underline"
      >
        <span aria-hidden>←</span> All tables
      </Link>
      <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Tables
      </p>
      <nav className="flex flex-col gap-0.5">
        {tables.map((t) => {
          const active = pathname === `/tables/${encodeURIComponent(t.name)}`;
          return (
            <Link
              key={t.name}
              href={`/tables/${encodeURIComponent(t.name)}`}
              className={`truncate rounded-md px-2 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-blue-50 font-medium text-blue-700"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.name}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
