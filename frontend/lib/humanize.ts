// Translates Great Expectations' technical rule names into short, plain-English
// labels so non-technical users see "Values must not be empty" instead of
// "expect_column_values_to_not_be_null".
const FRIENDLY_NAMES: Record<string, string> = {
  expect_column_values_to_not_be_null: "Values must not be empty",
  expect_column_values_to_be_unique: "Values must be unique",
  expect_column_values_to_be_in_set: "Values must be from an allowed list",
  expect_column_values_to_be_between: "Values must be within a range",
  expect_column_values_to_match_regex: "Values must match a pattern",
  expect_column_values_to_be_of_type: "Values must be a specific data type",
  expect_column_values_to_be_in_type_list: "Values must be one of a few data types",
  expect_column_value_lengths_to_be_between: "Text length must be within a range",
  expect_table_row_count_to_be_between: "Table row count must be within a range",
  expect_column_values_to_not_match_regex: "Values must not match a pattern",
  expect_column_mean_to_be_between: "Average value must be within a range",
  expect_column_median_to_be_between: "Median value must be within a range",
  expect_column_sum_to_be_between: "Total value must be within a range",
  expect_column_values_to_match_strftime_format: "Dates must follow a specific format",
  expect_compound_columns_to_be_unique: "Combination of columns must be unique",
};

// Relative time for "last run 3h ago" labels - lets users tell a fresh
// result from a stale one at a glance instead of assuming a shown badge is
// current just because it's there.
export function timeAgo(isoString: string | null | undefined): string {
  if (!isoString) return "";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function humanizeRuleType(expectationType: string): string {
  if (FRIENDLY_NAMES[expectationType]) return FRIENDLY_NAMES[expectationType];
  // Fallback: turn "expect_column_values_to_do_x" into "Column values to do x".
  return expectationType
    .replace(/^expect_/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

// Kwargs keys we know how to render as plain form fields instead of raw
// JSON. Anything outside this set falls back to the JSON editor, but this
// covers the common AI-suggested shapes (allowed list, range, pattern,
// failure threshold) so most users never see JSON at all.
const FRIENDLY_KWARG_KEYS = new Set(["column", "value_set", "min_value", "max_value", "regex", "mostly"]);

export function isFriendlyEditable(kwargs: Record<string, unknown>): boolean {
  return Object.keys(kwargs).every((k) => FRIENDLY_KWARG_KEYS.has(k));
}
