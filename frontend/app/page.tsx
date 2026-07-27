"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import type { TableInfo } from "@/lib/types";

export default function HomePage() {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .listTables()
      .then((res) => setTables(res.tables))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Table Explorer</h1>
      <p className="mb-6 text-sm text-gray-500">
        Pick a table to view its schema, get AI-suggested data quality rules, and run checks.
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.map((t) => (
          <Link key={t.name} href={`/tables/${t.name}`}>
            <Card className="h-full transition hover:border-blue-400 hover:shadow-md">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">{t.name}</h2>
                <Badge tone="blue">{t.row_count ?? "?"} rows</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
