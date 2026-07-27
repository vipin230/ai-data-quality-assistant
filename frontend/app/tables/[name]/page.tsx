"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { humanizeRuleType, isFriendlyEditable } from "@/lib/humanize";
import type { ColumnInfo, Rule, RunResult } from "@/lib/types";

type Tab = "schema" | "rules" | "results";

export default function TableDetailPage({ params }: { params: { name: string } }) {
  const table = decodeURIComponent(params.name);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "schema";
  const [tab, setTabState] = useState<Tab>(initialTab);

  // Keep the current tab reflected in the URL (?tab=...) so the header's
  // step indicator can tell whether the user is choosing rules or viewing
  // results, and so the tab survives a page refresh or back/forward nav.
  function setTab(next: Tab) {
    setTabState(next);
    router.replace(`/tables/${encodeURIComponent(table)}?tab=${next}`, { scroll: false });
  }

  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [sample, setSample] = useState<Record<string, unknown>[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [run, setRun] = useState<RunResult | null>(null);

  const [loadingRules, setLoadingRules] = useState(false);
  const [runningRules, setRunningRules] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [nlText, setNlText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  // Backend returns rules oldest-first (by id); reverse so newly added rules
  // show up at the top of the list, where users expect to see them.
  const refreshRules = () => api.getRules(table).then((r) => setRules([...r.rules].reverse()));
  const refreshRun = () =>
    api
      .getLatestRun(table)
      .then((r) => setRun(r.result === null ? null : r))
      .catch(() => setRun(null));

  useEffect(() => {
    setPageLoading(true);
    setInfoMessage(null);
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

  const [suggestions, setSuggestions] = useState<any[] | null>(null);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());
  const [accepting, setAccepting] = useState(false);

  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  async function handleGenerate() {
    setLoadingRules(true);
    setError(null);
    setInfoMessage(null);
    try {
      const res = await api.suggestRules(table);
      if (res.suggestions.length === 0) {
        setInfoMessage("AI couldn't find any confident rules to suggest for this table.");
        setSuggestions(null);
      } else {
        setSuggestions(res.suggestions);
        // Pre-select only the ones that aren't already stored.
        setSelectedSuggestions(
          new Set(res.suggestions.map((_, i) => i).filter((i) => !res.suggestions[i].already_exists))
        );
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingRules(false);
    }
  }

  function toggleSuggestion(i: number) {
    setSelectedSuggestions((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function handleAcceptSuggestions() {
    if (!suggestions) return;
    const chosen = suggestions.filter((_, i) => selectedSuggestions.has(i));
    if (chosen.length === 0) {
      setSuggestions(null);
      return;
    }
    setAccepting(true);
    setError(null);
    try {
      const res = await api.acceptRules(table, chosen);
      await refreshRules();
      setInfoMessage(`Added ${res.added_count} new AI-suggested rule(s).`);
      setSuggestions(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAccepting(false);
    }
  }

  function handleDismissSuggestions() {
    setSuggestions(null);
  }

  async function handleAddNl() {
    if (!nlText.trim()) return;
    setLoadingRules(true);
    setError(null);
    setInfoMessage(null);
    try {
      const res = await api.addNlRule(table, nlText.trim());
      setNlText("");
      setInfoMessage(
        `Added ${res.rules.length} rule${res.rules.length === 1 ? "" : "s"} from that description.`
      );
      await refreshRules();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingRules(false);
    }
  }

  async function handleToggle(rule: Rule) {
    setInfoMessage(null);
    await api.updateRule(rule.id, { enabled: !rule.enabled });
    await refreshRules();
  }

  async function handleDelete(rule: Rule) {
    const ok = window.confirm(
      `Delete rule "${rule.expectation_type}" on this table? This cannot be undone.`
    );
    if (!ok) return;
    setInfoMessage(null);
    await api.deleteRule(rule.id);
    await refreshRules();
  }

  function toggleRuleSelected(ruleId: number) {
    setSelectedRuleIds((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) next.delete(ruleId);
      else next.add(ruleId);
      return next;
    });
  }

  function toggleSelectAllRules() {
    setSelectedRuleIds((prev) => (prev.size === rules.length ? new Set() : new Set(rules.map((r) => r.id))));
  }

  async function handleBulkDelete() {
    if (selectedRuleIds.size === 0) return;
    const ok = window.confirm(`Delete ${selectedRuleIds.size} selected rule(s)? This cannot be undone.`);
    if (!ok) return;
    setBulkDeleting(true);
    setError(null);
    setInfoMessage(null);
    try {
      await Promise.all([...selectedRuleIds].map((id) => api.deleteRule(id)));
      setSelectedRuleIds(new Set());
      await refreshRules();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBulkDeleting(false);
    }
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
    setInfoMessage(null);
    try {
      await api.updateRule(ruleId, { description, kwargs });
      await refreshRules();
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    }
  }

  async function handleRun() {
    setRunningRules(true);
    setError(null);
    setInfoMessage(null);
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

  const tabMeta: Record<Tab, { label: string; icon: string; hint: string }> = {
    schema: { label: "Data preview", icon: "📄", hint: "Columns & sample rows" },
    rules: { label: "Quality rules", icon: "🛡️", hint: "What to check for" },
    results: { label: "Check results", icon: "📊", hint: "Pass/fail report" },
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{table}</h1>
          <p className="text-sm text-slate-500">Review its rules, then run a check whenever you like.</p>
        </div>
        <button
          onClick={handleRun}
          disabled={runningRules || rules.filter((r) => r.enabled).length === 0}
          title={
            rules.filter((r) => r.enabled).length === 0
              ? "Add at least one rule first"
              : "Run all enabled rules now"
          }
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
        >
          {runningRules ? "Running…" : "▶ Run Quality Checks"}
        </button>
      </div>

      {error && (
        <Card className="mb-4 border-rose-200 bg-rose-50 text-rose-700">⚠️ {error}</Card>
      )}

      {infoMessage && (
        <Card className="mb-4 border-blue-200 bg-blue-50 text-blue-700">ℹ️ {infoMessage}</Card>
      )}

      <div className="mb-6 flex flex-wrap gap-2">
        {(["schema", "rules", "results"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => {
              setInfoMessage(null);
              setTab(t);
            }}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
              tab === t
                ? "border-blue-600 bg-blue-50 text-blue-700"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            <span aria-hidden>{tabMeta[t].icon}</span>
            <span>
              {tabMeta[t].label}
              <span className="ml-1.5 hidden text-xs font-normal text-slate-400 sm:inline">
                · {tabMeta[t].hint}
              </span>
            </span>
          </button>
        ))}
      </div>

      {pageLoading && (
        <Card className="flex items-center gap-3 text-sm text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
          Loading table data…
        </Card>
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
          suggestions={suggestions}
          selectedSuggestions={selectedSuggestions}
          onToggleSuggestion={toggleSuggestion}
          onAcceptSuggestions={handleAcceptSuggestions}
          onDismissSuggestions={handleDismissSuggestions}
          accepting={accepting}
          selectedRuleIds={selectedRuleIds}
          onToggleRuleSelected={toggleRuleSelected}
          onToggleSelectAllRules={toggleSelectAllRules}
          onBulkDelete={handleBulkDelete}
          bulkDeleting={bulkDeleting}
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
        <h2 className="mb-3 font-medium text-slate-800">Columns in this table</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-slate-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Type</th>
              <th className="pb-2">Can be empty?</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <tr key={c.column_name} className="border-t border-slate-100">
                <td className="py-1.5 font-mono text-slate-700">{c.column_name}</td>
                <td className="py-1.5 text-slate-500">{c.data_type}</td>
                <td className="py-1.5">
                  <Badge tone={c.is_nullable === "YES" ? "yellow" : "gray"}>
                    {c.is_nullable === "YES" ? "Yes" : "No"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 className="mb-3 font-medium text-slate-800">A peek at the data (first 10 rows)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500">
                {columns.map((c) => (
                  <th key={c.column_name} className="whitespace-nowrap pb-2 pr-4">
                    {c.column_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((row, i) => (
                <tr key={i} className="border-t border-slate-100">
                  {columns.map((c) => (
                    <td key={c.column_name} className="whitespace-nowrap py-1.5 pr-4 text-slate-600">
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
  suggestions,
  selectedSuggestions,
  onToggleSuggestion,
  onAcceptSuggestions,
  onDismissSuggestions,
  accepting,
  selectedRuleIds,
  onToggleRuleSelected,
  onToggleSelectAllRules,
  onBulkDelete,
  bulkDeleting,
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
  suggestions: any[] | null;
  selectedSuggestions: Set<number>;
  onToggleSuggestion: (i: number) => void;
  onAcceptSuggestions: () => void;
  onDismissSuggestions: () => void;
  accepting: boolean;
  selectedRuleIds: Set<number>;
  onToggleRuleSelected: (ruleId: number) => void;
  onToggleSelectAllRules: () => void;
  onBulkDelete: () => void;
  bulkDeleting: boolean;
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
        <h2 className="mb-1 font-medium text-slate-800">Add rules</h2>
        <p className="mb-3 text-xs text-slate-500">
          Let AI scan this table for good rules, or describe one yourself in plain English.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            onClick={onGenerate}
            disabled={loading}
            className="rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
          >
            {loading ? "Thinking…" : "✨ Suggest rules with AI"}
          </button>
          <div className="flex flex-1 gap-2">
            <input
              value={nlText}
              onChange={(e) => onNlTextChange(e.target.value)}
              placeholder='e.g. "email should never be empty"'
              className="flex-1 rounded-md border border-slate-200 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              onKeyDown={(e) => e.key === "Enter" && onAddNl()}
            />
            <button
              onClick={onAddNl}
              disabled={loading || !nlText.trim()}
              className="rounded-md border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Add rule
            </button>
          </div>
        </div>
      </Card>

      {suggestions && (
        <Card className="border-blue-200 bg-blue-50/40">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-medium text-slate-800">
              ✨ AI found {suggestions.length} suggested rule{suggestions.length === 1 ? "" : "s"} — pick which to add
            </h3>
            <span className="text-xs text-slate-500">{selectedSuggestions.size} selected</span>
          </div>
          <div className="space-y-2">
            {suggestions.map((s, i) => (
              <label
                key={i}
                className={`flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm ${
                  s.already_exists ? "opacity-50" : ""
                }`}
              >
                <input
                  type="checkbox"
                  className="mt-1 accent-blue-600"
                  checked={selectedSuggestions.has(i)}
                  onChange={() => onToggleSuggestion(i)}
                />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800">{humanizeRuleType(s.expectation_type)}</span>
                    {s.kwargs?.column ? <Badge tone="blue">{String(s.kwargs.column)}</Badge> : null}
                  </div>
                  {s.description && <div className="text-slate-600">{s.description}</div>}
                  {s.already_exists && <Badge tone="gray">Already in your rule list</Badge>}
                </div>
              </label>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              onClick={onAcceptSuggestions}
              disabled={accepting}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-40"
            >
              {accepting ? "Adding…" : `Add selected (${selectedSuggestions.size})`}
            </button>
            <button
              onClick={onDismissSuggestions}
              disabled={accepting}
              className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </Card>
      )}

      {rules.length === 0 && (
        <Card className="text-center text-slate-500">
          <p className="text-3xl">🛡️</p>
          <p className="mt-2 font-medium">No rules yet</p>
          <p className="mt-1 text-sm">Click &quot;✨ Suggest rules with AI&quot; above to get started in seconds.</p>
        </Card>
      )}

      {rules.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <label className="flex items-center gap-2 text-slate-600">
            <input
              type="checkbox"
              className="accent-blue-600"
              checked={selectedRuleIds.size === rules.length}
              onChange={onToggleSelectAllRules}
            />
            Select all ({rules.length})
          </label>
          {selectedRuleIds.size > 0 && (
            <button
              onClick={onBulkDelete}
              disabled={bulkDeleting}
              className="rounded-md border border-rose-200 px-3 py-1 text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              {bulkDeleting ? "Deleting…" : `Delete selected (${selectedRuleIds.size})`}
            </button>
          )}
        </div>
      )}

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
            selected={selectedRuleIds.has(r.id)}
            onToggleSelected={() => onToggleRuleSelected(r.id)}
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
  selected,
  onToggleSelected,
}: {
  rule: Rule;
  sourceTone: Record<Rule["source"], "blue" | "green" | "gray">;
  sourceLabel: Record<Rule["source"], string>;
  onToggle: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
  onEditSave: (ruleId: number, description: string, kwargsText: string) => Promise<boolean>;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [description, setDescription] = useState(r.description ?? "");
  const [kwargsText, setKwargsText] = useState(JSON.stringify(r.kwargs, null, 2));

  // Friendly form state, only used when isFriendlyEditable(r.kwargs) is
  // true - value_set as a comma-separated list, min/max/regex as plain
  // fields. Falls back to raw JSON for any rule shape we don't recognize
  // (rare - only unusual AI/manual kwargs combos hit this).
  const friendly = isFriendlyEditable(r.kwargs);
  const [valueSetText, setValueSetText] = useState(
    Array.isArray((r.kwargs as any).value_set) ? (r.kwargs as any).value_set.join(", ") : ""
  );
  const [minValue, setMinValue] = useState(String((r.kwargs as any).min_value ?? ""));
  const [maxValue, setMaxValue] = useState(String((r.kwargs as any).max_value ?? ""));
  const [regex, setRegex] = useState(String((r.kwargs as any).regex ?? ""));
  const [useJsonEditor, setUseJsonEditor] = useState(false);

  function startEdit() {
    setDescription(r.description ?? "");
    setKwargsText(JSON.stringify(r.kwargs, null, 2));
    setValueSetText(Array.isArray((r.kwargs as any).value_set) ? (r.kwargs as any).value_set.join(", ") : "");
    setMinValue(String((r.kwargs as any).min_value ?? ""));
    setMaxValue(String((r.kwargs as any).max_value ?? ""));
    setRegex(String((r.kwargs as any).regex ?? ""));
    setUseJsonEditor(false);
    setEditing(true);
  }

  // Parses a comma-separated allowed-list back into typed values (true/false/
  // numbers stay typed, everything else stays a string) so "true, false"
  // round-trips to booleans rather than the literal strings "true"/"false".
  function parseValueSet(text: string): unknown[] {
    return text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => {
        if (s === "true") return true;
        if (s === "false") return false;
        if (s === "null") return null;
        if (!Number.isNaN(Number(s)) && s !== "") return Number(s);
        return s;
      });
  }

  async function save() {
    setSaving(true);
    let text = kwargsText;
    if (friendly && !useJsonEditor) {
      const built: Record<string, unknown> = { column: (r.kwargs as any).column };
      if ("value_set" in r.kwargs) built.value_set = parseValueSet(valueSetText);
      if ("min_value" in r.kwargs) built.min_value = minValue === "" ? null : Number(minValue);
      if ("max_value" in r.kwargs) built.max_value = maxValue === "" ? null : Number(maxValue);
      if ("regex" in r.kwargs) built.regex = regex;
      if ("mostly" in r.kwargs) built.mostly = (r.kwargs as any).mostly;
      text = JSON.stringify(built);
    }
    const ok = await onEditSave(r.id, description, text);
    setSaving(false);
    if (ok) setEditing(false);
  }

  return (
    <Card className={!r.enabled ? "opacity-50" : ""}>
      <div className="flex items-start justify-between gap-4">
        <input
          type="checkbox"
          className="mt-1 accent-blue-600"
          checked={selected}
          onChange={onToggleSelected}
          aria-label="Select rule"
        />
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-800">{humanizeRuleType(r.expectation_type)}</span>
            {r.kwargs?.column ? <Badge tone="blue">{String(r.kwargs.column)}</Badge> : null}
            <Badge tone={sourceTone[r.source]}>{sourceLabel[r.source]}</Badge>
            {!r.enabled && <Badge tone="gray">Disabled</Badge>}
          </div>

          {!editing && (
            <>
              {r.description && <p className="mb-1 text-sm text-slate-600">{r.description}</p>}
              {r.nl_prompt && (
                <p className="text-xs italic text-slate-400">You asked: &quot;{r.nl_prompt}&quot;</p>
              )}
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline"
              >
                {showAdvanced ? "Hide technical details" : "Show technical details"}
              </button>
              {showAdvanced && (
                <div className="mt-2 space-y-1">
                  <p className="font-mono text-xs text-slate-400">{r.expectation_type}</p>
                  <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs text-slate-500">
                    {JSON.stringify(r.kwargs, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}

          {editing && (
            <div className="space-y-3">
              {typeof (r.kwargs as any).column === "string" && (
                <p className="text-xs text-slate-400">
                  Column: <span className="font-mono text-slate-600">{(r.kwargs as any).column}</span>
                </p>
              )}
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />

              {friendly && !useJsonEditor && (
                <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                  {"value_set" in r.kwargs && (
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-slate-600">Allowed values (comma-separated)</span>
                      <input
                        value={valueSetText}
                        onChange={(e) => setValueSetText(e.target.value)}
                        placeholder="e.g. true, false  or  bronze, silver, gold"
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </label>
                  )}
                  {("min_value" in r.kwargs || "max_value" in r.kwargs) && (
                    <div className="flex gap-2">
                      {"min_value" in r.kwargs && (
                        <label className="block flex-1 text-xs">
                          <span className="mb-1 block font-medium text-slate-600">Minimum</span>
                          <input
                            type="number"
                            value={minValue}
                            onChange={(e) => setMinValue(e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                      )}
                      {"max_value" in r.kwargs && (
                        <label className="block flex-1 text-xs">
                          <span className="mb-1 block font-medium text-slate-600">Maximum</span>
                          <input
                            type="number"
                            value={maxValue}
                            onChange={(e) => setMaxValue(e.target.value)}
                            className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </label>
                      )}
                    </div>
                  )}
                  {"regex" in r.kwargs && (
                    <label className="block text-xs">
                      <span className="mb-1 block font-medium text-slate-600">Pattern (regex)</span>
                      <input
                        value={regex}
                        onChange={(e) => setRegex(e.target.value)}
                        className="w-full rounded-md border border-slate-200 px-2 py-1.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </label>
                  )}
                  <button
                    onClick={() => setUseJsonEditor(true)}
                    className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
                  >
                    Edit raw JSON instead
                  </button>
                </div>
              )}

              {(!friendly || useJsonEditor) && (
                <div>
                  <p className="mb-1 text-xs font-medium text-slate-500">
                    Rule settings (advanced, JSON format)
                  </p>
                  <textarea
                    value={kwargsText}
                    onChange={(e) => setKwargsText(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-slate-200 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  {friendly && (
                    <button
                      onClick={() => setUseJsonEditor(false)}
                      className="mt-1 text-xs text-slate-400 hover:text-slate-600 hover:underline"
                    >
                      Back to simple editor
                    </button>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={save}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
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
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
            >
              Edit
            </button>
          )}
          <button
            onClick={() => onToggle(r)}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
          >
            {r.enabled ? "Disable" : "Enable"}
          </button>
          <button
            onClick={() => onDelete(r)}
            className="rounded-md border border-rose-200 px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
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
    return (
      <Card className="text-center text-slate-500">
        <p className="text-3xl">📊</p>
        <p className="mt-2 font-medium">No results yet</p>
        <p className="mt-1 text-sm">Click &quot;▶ Run Quality Checks&quot; above to check this table.</p>
      </Card>
    );
  }

  const pct =
    run.summary.total_rules > 0
      ? Math.round((run.summary.success_count / run.summary.total_rules) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Badge tone={run.success ? "green" : "red"}>
            {run.success ? "✅ All checks passed" : "⚠️ Some checks failed"}
          </Badge>
          <span className="text-xs text-slate-400">
            Last run: {new Date(run.run_at).toLocaleString()}
          </span>
        </div>

        <div className="mb-1 flex items-center justify-between text-sm text-slate-600">
          <span>
            {run.summary.success_count} of {run.summary.total_rules} rules passed
          </span>
          <span className="font-medium">{pct}%</span>
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{
              width: `${pct}%`,
              backgroundColor: run.success ? "#10b981" : pct >= 50 ? "#f59e0b" : "#f43f5e",
            }}
          />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {run.summary.rows_evaluated} row(s) evaluated
          {run.summary.sampled && run.summary.total_row_count != null && (
            <> (a sample out of {run.summary.total_row_count} total rows)</>
          )}
        </p>
        {run.summary.sampled && (
          <p className="mt-2 text-xs text-amber-700">
            ⚠️ This table is larger than the check window, so results are based on a sample, not
            every row.
          </p>
        )}
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
    <Card className={r.success ? "" : "border-rose-200 bg-rose-50"}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge tone={r.success ? "green" : "red"}>{r.success ? "Pass" : "Fail"}</Badge>
            <span className="font-medium text-slate-800">{humanizeRuleType(r.expectation_type)}</span>
            {r.kwargs?.column ? <Badge tone="blue">{String(r.kwargs.column)}</Badge> : null}
          </div>
          {r.description && <p className="text-sm text-slate-600">{r.description}</p>}
          {r.error && <p className="mt-1 text-sm text-rose-700">Error: {r.error}</p>}
          {plainSummary && <p className="mt-1 text-sm text-rose-700">{plainSummary}</p>}

          {r.result && (
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="mt-2 text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline"
            >
              {showDetails ? "Hide technical details" : "Show technical details"}
            </button>
          )}
          {showDetails && r.result && (
            <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-slate-600">
              {JSON.stringify(r.result, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </Card>
  );
}
