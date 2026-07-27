export type TableInfo = {
  name: string;
  row_count: number | null;
};

export type ColumnInfo = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

export type Rule = {
  id: number;
  expectation_type: string;
  kwargs: Record<string, unknown>;
  description: string | null;
  source: "ai_auto" | "ai_nl" | "manual";
  nl_prompt: string | null;
  enabled: boolean;
};

export type RuleResult = {
  rule_id: number | null;
  expectation_type: string;
  kwargs?: Record<string, unknown>;
  description: string;
  success: boolean;
  error?: string;
  result?: Record<string, unknown>;
};

export type RunSummary = {
  total_rules: number;
  success_count: number;
  failed_count: number;
  rows_evaluated: number;
  total_row_count?: number | null;
  sampled?: boolean;
  evaluated_at: string;
};

export type RunResult = {
  id: number;
  table: string;
  success: boolean;
  summary: RunSummary;
  results: RuleResult[];
  run_at: string;
};
