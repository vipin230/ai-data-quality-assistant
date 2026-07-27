"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import type { ColumnInfo, Rule, RunResult } from "@/lib/types";

type Tab = "schema" | "rules" | "results";

export default function TableDetailPage({ params }: { params: { name: string } }) {
  const table = decodeURIComponent(params.name);
  const [tab, setTab] = useState<Tab>("rules");

  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [sample, setSample] = useState<Record<string, unknown>[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [run, setRun] = useState<RunResult | null>(null);

  const [loadingRules, setLoadingRules] = useState(false);
  const [runningRules, setRunningRules] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [nlText, setNlText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshRules = () => api.getRules(table).then((r) => setRules(r.rules));
  const refreshRun = () =>
    api
      .getLatestRun(table)
      .then((r) => setRun(r.result === null ? null : r))
      .catch(() => setRun(null));

  useEffect(() => {
    setPageLoading(true);
    Promise.allSettled([
      api.getSchema(table).then((r) => setColumns(r.columns)),
      api.getSample(table, 10).then((r) => setSample(r.rows)),
      refreshRules(),
      refreshRun(),
    ])
      .then((results) => {
        const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        if (failed) setError(failed.reason?.message ?? "Failed to load table data");
      })
      .finally(() => setPageLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table]);

  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  async function handleGenerate() {
    setLoadingRules(true);
    setError(null);
    setInfoMessage(null);
    try {
      const res = await api.generateRules(table);
      await refreshRules();
      if ((res.added_count ?? res.rules.length) === 0) {
        setInfoMessage("AI didn't find any new rules to add — everything it suggests is already in your rule list.");
      } else {
        setInfoMessage(`Added ${res.added_count} new AI-suggested rule(s).`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingRules(false);
    }
  }

  async function handleAddNl() {
    if (!nlText.trim()) return;
    setLoadingRules(true);
    setError(null);
    setInfoMessage(null);
    try {
      await api.addNlRule(table, nlText.trim());
      setNlText("");
      await refreshRules();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingRules(false);
    }
  }

  async function handleToggle(rule: Rule) {
    await api.updateRule(rule.id, { enabled: !rule.enabled });
    await refreshRules();
  }

  async function handleDelete(rule: Rule) {
    const ok = window.confirm(
      `Delete rule "${rule.expectation_type}" on this table? This cannot be undone.`
    );
    if (!ok) return;
    await api.deleteRule(rule.id);
    await refreshRules();
  }

  async function handleEditSave(ruleId: number, description: string, kwargsText: string) {
    let kwargs: Record<string, unknown>;
    try {
      kwargs = JSON.parse(kwargsText);
    } catch {
      setError("Rule config must be valid JSON.");
      return false;
    }
    setError(null);
    await api.updateRule(ruleId, { description, kwargs });
    await refreshRules();
    return true;
  }

  async function handleRun() {
    setRunningRules(true);
    setError(null);
    try {
      const result = await api.runRules(table);
      setRun(result);
      setTab("results");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRunningRules(false);
    }
  }

  return (
    <div>
      <Link href="/" className="mb-3 inline-block text-sm text-blue-600 hover:underline">
        ← Back to all tables
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{table}</h1>
        <button
          onClick={handleRun}
          disabled={runningRules || rules.filter((r) => r.enabled).length === 0}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-40"
        >
          {runningRules ? "Running…" : "Run Quality Checks"}
        </button>
      </div>

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50 text-red-700">{error}</Card>
      )}

      {infoMessage && (
        <Card className="mb-4 border-blue-200 bg-blue-50 text-blue-700">{infoMessage}</Card>
      )}

      <div className="mb-6 flex gap-2 border-b">
        {(["schema", "rules", "results"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              tab === t ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {pageLoading && (
        <Card className="animate-pulse text-sm text-gray-400">Loading table data…</Card>
      )}

      {!pageLoading && tab === "schema" && <SchemaTab columns={columns} sample={sample} />}

      {!pageLoading && tab === "rules" && (
        <RulesTab
          rules={rules}
          loading={loadingRules}
          nlText={nlText}
          onNlTextChange={setNlText}
          onGenerate={handleGenerate}
          onAddNl={handleAddNl}
          onToggle={handleToggle}
          onDelete={handleDelete}
          onEditSave={handleEditSave}
        />
      )}

      {!pageLoading && tab === "results" && <ResultsTab run={run} />}
    </div>
  );
}

function SchemaTab({
  columns,
  sample,
}: {
  columns: ColumnInfo[];
  sample: Record<string, unknown>[];
}) {
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="mb-3 font-medium">Columns</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Nullable</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.column_name} className="border-t">
                <td className="py-1 font-mono">{c.column_name}</td>
                <td className="py-1 text-gray-600">{c.data_type}</td>
                <td className="py-1">
                  <Badge tone={c.is_nullable === "YES" ? "yellow" : "gray"}>{c.is_nullable}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium">Sample Data (first 10 rows)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-gray-500">
                {columns.map((c) => (
                  <th key={c.column_name} className="whitespace-nowrap pb-2 pr-4">
                    {c.column_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, i) => (
                <tr key={i} className="border-t">
                  {columns.map((c) => (
                    <td key={c.column_name} className="whitespace-nowrap py-1 pr-4">
                      {String(row[c.column_name] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RulesTab({
  rules,
  loading,
  nlText,
  onNlTextChange,
  onGenerate,
  onAddNl,
  onToggle,
  onDelete,
  onEditSave,
}: {
  rules: Rule[];
  loading: boolean;
  nlText: string;
  onNlTextChange: (v: string) => void;
  onGenerate: () => void;
  onAddNl: () => void;
  onToggle: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  onEditSave: (ruleId: number, description: string, kwargsText: string) => Promise<boolean>;
}) {
  const sourceTone: Record<Rule["source"], "blue" | "green" | "gray"> = {
    ai_auto: "blue",
    ai_nl: "green",
    manual: "gray",
  };
  const sourceLabel: Record<Rule["source"], string> = {
    ai_auto: "AI suggested",
    ai_nl: "AI (from text)",
    manual: "Manual",
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={onGenerate}
            disabled={loading}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
          >
            {loading ? "Thinking…" : "✨ Suggest rules with AI"}
          </button>
          <div className="flex flex-1 gap-2">
            <input
              value={nlText}
              onChange={(e) => onNlTextChange(e.target.value)}
              placeholder='Describe a rule in plain English, e.g. "email should never be empty"'
              className="flex-1 rounded-md border px-3 py-2 text-sm"
              onKeyDown={(e) => e.key === "Enter" && onAddNl()}
            />
            <button
              onClick={onAddNl}
              disabled={loading || !nlText.trim()}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
            >
              Add rule
            </button>
          </div>
        </div>
      </Card>

      {rules.length === 0 && <Card>No rules yet. Try &quot;Suggest rules with AI&quot; above.</Card>}

      <div className="space-y-3">
        {rules.map((r) => (
          <RuleCard
            key={r.id}
            rule={r}
            sourceTone={sourceTone}
            sourceLabel={sourceLabel}
            onToggle={onToggle}
            onDelete={onDelete}
            onEditSave={onEditSave}
          />
        ))}
      </div>
    </div>
  );
}

function RuleCard({
  rule: r,
  sourceTone,
  sourceLabel,
  onToggle,
  onDelete,
  onEditSave,
}: {
  rule: Rule;
  sourceTone: Record<Rule["source"], "blue" | "green" | "gray">;
  sourceLabel: Record<Rule["source"], string>;
  onToggle: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  onEditSave: (ruleId: number, description: string, kwargsText: string) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState(r.description ?? "");
  const [kwargsText, setKwargsText] = useState(JSON.stringify(r.kwargs, null, 2));

  function startEdit() {
    setDescription(r.description ?? "");
    setKwargsText(JSON.stringify(r.kwargs, null, 2));
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    const ok = await onEditSave(r.id, description, kwargsText);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <Card className={!r.enabled ? "opacity-50" : ""}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <span className="font-mono text-sm">{r.expectation_type}</span>
            <Badge tone={sourceTone[r.source]}>{sourceLabel[r.source]}</Badge>
          </div>

          {!editing && (
            <>
              {r.description && <p className="mb-1 text-sm text-gray-600">{r.description}</p>}
              {r.nl_prompt && (
                <p className="text-xs italic text-gray-400">Original: &quot;{r.nl_prompt}&quot;</p>
              )}
              <pre className="mt-2 overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-500">
                {JSON.stringify(r.kwargs, null, 2)}
              </pre>
            </>
          )}

          {editing && (
            <div className="space-y-2">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full rounded-md border px-2 py-1 text-sm"
              />
              <textarea
                value={kwargsText}
                onChange={(e) => setKwargsText(e.target.value)}
                rows={4}
                className="w-full rounded-md border px-2 py-1 font-mono text-xs"
              />
              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          {!editing && (
            <button
              onClick={startEdit}
              className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => onToggle(r)}
            className="rounded-md border px-3 py-1 text-xs hover:bg-gray-50"
          >
            {r.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => onDelete(r)}
            className="rounded-md border border-red-200 px-3 py-1 text-xs text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </Card>
  );
}

function ResultsTab({ run }: { run: RunResult | null }) {
  if (!run) {
    return <Card>No results yet. Run quality checks from the button above.</Card>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Badge tone={run.success ? "green" : "red"}>{run.success ? "All checks passed" : "Failures found"}</Badge>
          <span className="text-sm text-gray-600">
            {run.summary.success_count}/{run.summary.total_rules} rules passed ·{" "}
            {run.summary.rows_evaluated} rows evaluated
          </span>
          <span className="text-xs text-gray-400">
            Last run: {new Date(run.run_at).toLocaleString()}
          </span>
        </div>
      </Card>

      <div className="space-y-3">
        {run.results.map((r, i) => (
          <ResultCard key={i} r={r} />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ r }: { r: RunResult["results"][number] }) {
  const [showDetails, setShowDetails] = useState(false);

  // Turn GE's raw result payload into a one-line, plain-English summary so
  // non-technical users aren't confronted with a JSON blob by default.
  const inner = (r.result as any)?.result;
  let plainSummary: string | null = null;
  if (!r.success && inner) {
    const count = inner.unexpected_count;
    const pct = inner.unexpected_percent;
    const examples: unknown[] = inner.partial_unexpected_list ?? [];
    if (typeof count === "number") {
      plainSummary = `${count} value(s) (${pct != null ? pct.toFixed(1) : "?"}%) failed this check`;
      if (examples.length > 0) {
        plainSummary += ` — e.g. ${examples.slice(0, 3).map((v) => JSON.stringify(v)).join(", ")}`;
      }
    }
  }

  return (
    <Card className={r.success ? "" : "border-red-200 bg-red-50"}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone={r.success ? "green" : "red"}>{r.success ? "Pass" : "Fail"}</Badge>
            <span className="font-mono text-sm">{r.expectation_type}</span>
          </div>
          {r.description && <p className="text-sm text-gray-600">{r.description}</p>}
          {r.error && <p className="mt-1 text-sm text-red-700">Error: {r.error}</p>}
          {plainSummary && <p className="mt-1 text-sm text-red-700">{plainSummary}</p>}

          {r.result && (
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="mt-2 text-xs font-medium text-gray-500 hover:text-gray-700 hover:underline"
            >
              {showDetails ? "Hide raw details" : "Show raw details"}
            </button>
          )}
          {showDetails && r.result && (
            <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-gray-600">
              {JSON.stringify(r.result, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}
