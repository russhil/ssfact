// Shared, db-free colour key so fabric stock matches case-insensitively and
// whitespace-collapsed across the seed, server actions, and the job-card form.
export function colorKey(s: string | null | undefined): string {
  return (s ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}
