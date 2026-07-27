const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listTables: () => request<{ tables: { name: string; row_count: number | null }[] }>("/api/tables"),
  getSchema: (table: string) => request<{ table: string; columns: any[] }>(`/api/tables/${table}/schema`),
  getSample: (table: string, limit = 20) =>
    request<{ table: string; rows: Record<string, unknown>[] }>(`/api/tables/${table}/sample?limit=${limit}`),

  getRules: (table: string) => request<{ table: string; rules: any[] }>(`/api/rules/${table}`),
  suggestRules: (table: string) =>
    request<{ table: string; suggestions: any[] }>(`/api/rules/${table}/generate`, { method: "POST" }),
  acceptRules: (table: string, rules: any[]) =>
    request<{ table: string; rules: any[]; added_count: number; duplicate_count: number }>(
      `/api/rules/${table}/accept`,
      { method: "POST", body: JSON.stringify({ rules }) }
    ),
  addNlRule: (table: string, text: string) =>
    request<{ table: string; rules: any[] }>(`/api/rules/${table}/nl`, {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  updateRule: (ruleId: number, fields: Record<string, unknown>) =>
    request<any>(`/api/rules/rule/${ruleId}`, { method: "PATCH", body: JSON.stringify(fields) }),
  deleteRule: (ruleId: number) => request<any>(`/api/rules/rule/${ruleId}`, { method: "DELETE" }),

  runRules: (table: string) => request<any>(`/api/run/${table}`, { method: "POST" }),
  getLatestRun: (table: string) => request<any>(`/api/run/${table}/latest`),
  getRunHistory: (table: string) => request<any>(`/api/run/${table}/history`),

  // Convenience for bulk/whole-DB runs from the Table Explorer: ensures a
  // table has at least AI-suggested rules before running checks on it.
  // Unlike the interactive "Suggest rules with AI" flow (which previews and
  // asks for confirmation), this auto-accepts all suggestions - it only
  // triggers for tables that have zero rules, so there's nothing to
  // conflict with or silently duplicate.
  ensureRulesThenRun: async (table: string) => {
    const existing = await request<{ table: string; rules: any[] }>(`/api/rules/${table}`);
    if (existing.rules.length === 0) {
      const preview = await request<{ table: string; suggestions: any[] }>(`/api/rules/${table}/generate`, {
        method: "POST",
      });
      if (preview.suggestions.length > 0) {
        await request<any>(`/api/rules/${table}/accept`, {
          method: "POST",
          body: JSON.stringify({ rules: preview.suggestions }),
        });
      }
    }
    return request<any>(`/api/run/${table}`, { method: "POST" });
  },
};
