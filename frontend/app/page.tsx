"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import type { TableInfo } from "@/lib/types";
import { timeAgo } from "@/lib/humanize";

type RunStatus = "idle" | "running" | "done" | "error";

export default function HomePage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRunning, setBulkRunning] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, { status: RunStatus; message?: string }>>({});

  useEffect(() => {
    api
      .listTables()
      .then(async (res) => {
        setTables(res.tables);
        // Hydrate each table's last-known result from the backend (results
        // are persisted server-side) so switching pages/tables doesn't wipe
        // out what was already run - only in-flight "Checking..." state is
        // ever lost on navigation, not completed results.
        const entries = await Promise.all(
          res.tables.map(async (t) => {
            try {
              const latest = await api.getLatestRun(t.name);
              if (!latest?.summary) return null;
              return [
                t.name,
                {
                  status: "done" as const,
                  message: `${latest.summary.success_count}/${latest.summary.total_rules} rules passed · ${timeAgo(
                    latest.run_at
                  )}`,
                },
              ] as const;
            } catch {
              return null;
            }
          })
        );
        setStatuses((prev) => {
          const next = { ...prev };
          for (const entry of entries) {
            if (entry) next[entry[0]] = entry[1];
          }
          return next;
        });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(tables.map((t) => t.name)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  async function runOnTables(tableNames: string[]) {
    if (tableNames.length === 0) return;
    setBulkRunning(true);
    setStatuses((prev) => {
      const next = { ...prev };
      tableNames.forEach((t) => (next[t] = { status: "running" }));
      return next;
    });

    // Run sequentially so we don't hammer the LLM/API with parallel bursts,
    // and so per-table progress can be shown incrementally in the UI.
    for (const table of tableNames) {
      try {
        const run = await api.ensureRulesThenRun(table);
        setStatuses((prev) => ({
          ...prev,
          [table]: {
            status: "done",
            message: `${run.summary.success_count}/${run.summary.total_rules} rules passed`,
          },
        }));
      } catch (e: any) {
        setStatuses((prev) => ({ ...prev, [table]: { status: "error", message: e.message } }));
      }
    }
    setBulkRunning(false);
  }

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Your tables</h1>
      <p className="mb-6 max-w-2xl text-sm text-slate-500">
        Pick a table below to review its data and quality rules, or run a quick check on several
        tables at once. No coding needed — the AI will suggest sensible rules for you.
      </p>

      {loading && (
        <Card className="flex items-center gap-3 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          Loading your tables…
        </Card>
      )}

      {error && (
        <Card className="border-rose-200 bg-rose-50 text-rose-700">
          <p className="font-medium">We couldn&apos;t connect to the server.</p>
          <p className="mt-1 text-sm">
            {error}. Please check with your administrator that the app&apos;s backend service is
            running.
          </p>
        </Card>
      )}

      {!loading && !error && tables.length === 0 && (
        <Card className="text-center text-slate-500">
          <p className="text-3xl">📭</p>
          <p className="mt-2 font-medium">No tables found</p>
          <p className="mt-1 text-sm">There don&apos;t seem to be any tables in the connected database yet.</p>
        </Card>
      )}

      {!loading && !error && tables.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <button
            onClick={selectAll}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Select all ({tables.length})
          </button>
          <button
            onClick={clearSelection}
            disabled={selected.size === 0}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            Clear selection
          </button>
          <div className="flex-1" />
          <button
            onClick={() => runOnTables(Array.from(selected))}
            disabled={selected.size === 0 || bulkRunning}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
          >
            {bulkRunning ? "Running…" : `▶ Run checks on selected (${selected.size})`}
          </button>
          <button
            onClick={() => runOnTables(tables.map((t) => t.name))}
            disabled={bulkRunning}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
          >
            {bulkRunning ? "Running…" : "▶ Run checks on everything"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => {
          const status = statuses[t.name];
          return (
            <Card
              key={t.name}
              className={`h-full transition-shadow hover:shadow-md ${
                selected.has(t.name) ? "ring-2 ring-blue-500" : ""
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(t.name)}
                    onChange={() => toggle(t.name)}
                    className="h-4 w-4 rounded accent-blue-600"
                  />
                  <span className="font-semibold text-slate-800">{t.name}</span>
                </label>
                <Badge tone="blue">{t.row_count ?? "?"} rows</Badge>
              </div>

              {status && (
                <div className="mb-3 text-xs">
                  {status.status === "running" && <Badge tone="yellow">⏳ Checking…</Badge>}
                  {status.status === "done" && <Badge tone="green">✅ Last run: {status.message}</Badge>}
                  {status.status === "error" && <Badge tone="red">⚠️ Failed: {status.message}</Badge>}
                </div>
              )}

              <Link
                href={`/tables/${encodeURIComponent(t.name)}`}
                className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700 hover:underline"
              >
                Open table <span aria-hidden>→</span>
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
