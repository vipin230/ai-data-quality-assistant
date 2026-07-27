"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import type { TableInfo } from "@/lib/types";

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
      .then((res) => setTables(res.tables))
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
      <h1 className="mb-1 text-2xl font-semibold">Table Explorer</h1>
      <p className="mb-6 text-sm text-gray-500">
        Select a table to open its schema, AI-suggested rules, and results — or select multiple
        tables (or the whole database) below to run quality checks in bulk.
      </p>

      {loading && <p className="text-gray-500">Loading tables…</p>}

      {error && (
        <Card className="border-red-200 bg-red-50 text-red-700">
          Couldn&apos;t reach the backend API: {error}. Make sure the FastAPI server is running and
          DATABASE_URL is configured in backend/.env.
        </Card>
      )}

      {!loading && !error && tables.length === 0 && (
        <Card>No tables found in the connected database&apos;s public schema.</Card>
      )}

      {!loading && !error && tables.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <button
            onClick={selectAll}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-gray-50"
          >
            Select all ({tables.length})
          </button>
          <button
            onClick={clearSelection}
            disabled={selected.size === 0}
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-40"
          >
            Clear selection
          </button>
          <div className="flex-1" />
          <button
            onClick={() => runOnTables(Array.from(selected))}
            disabled={selected.size === 0 || bulkRunning}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {bulkRunning ? "Running…" : `Run checks on selected (${selected.size})`}
          </button>
          <button
            onClick={() => runOnTables(tables.map((t) => t.name))}
            disabled={bulkRunning}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {bulkRunning ? "Running…" : "Run checks on entire database"}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => {
          const status = statuses[t.name];
          return (
            <Card key={t.name} className="h-full">
              <div className="mb-2 flex items-start justify-between gap-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(t.name)}
                    onChange={() => toggle(t.name)}
                    className="h-4 w-4"
                  />
                  <span className="font-medium">{t.name}</span>
                </label>
                <Badge tone="blue">{t.row_count ?? "?"} rows</Badge>
              </div>

              {status && (
                <div className="mb-2 text-xs">
                  {status.status === "running" && <Badge tone="yellow">Running…</Badge>}
                  {status.status === "done" && <Badge tone="green">{status.message}</Badge>}
                  {status.status === "error" && <Badge tone="red">Failed: {status.message}</Badge>}
                </div>
              )}

              <Link
                href={`/tables/${t.name}`}
                className="text-sm font-medium text-blue-600 hover:underline"
              >
                Open table →
              </Link>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
