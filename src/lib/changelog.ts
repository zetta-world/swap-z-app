import { execSync } from "child_process";
import path from "path";

export interface ChangelogEntry {
  sha:     string;
  shortSha: string;
  month:   string; // "2026-06"
  subject: string;
  type:    string; // "feat" | "fix" | "polish" | "chore"
  scope:   string; // extracted from type(scope):
  title:   string; // human-readable title after removing prefix
}

export interface ChangelogMonth {
  label:   string; // "June 2026"
  key:     string; // "2026-06" — for React keys
  entries: ChangelogEntry[];
}

const TYPE_ORDER: Record<string, number> = { feat: 0, polish: 1, fix: 2, chore: 3 };

const MONTH_NAMES: Record<string, string> = {
  "01": "January", "02": "February", "03": "March",    "04": "April",
  "05": "May",     "06": "June",     "07": "July",     "08": "August",
  "09": "September","10": "October", "11": "November", "12": "December",
};

function formatMonthLabel(key: string): string {
  const [year, mon] = key.split("-");
  return `${MONTH_NAMES[mon] ?? mon} ${year}`;
}

function parseEntry(line: string): ChangelogEntry | null {
  const [sha, month, ...rest] = line.split("|");
  const subject = rest.join("|").trim();
  if (!sha || !month || !subject) return null;

  // Match: type(scope): title  OR  type: title
  const m = subject.match(/^(feat|fix|polish|chore|i18n|harden|diag)(?:\(([^)]+)\))?[!]?:\s+(.+)$/i);
  if (!m) return null;

  const [, rawType, scope = "", title] = m;
  // Normalise type aliases into canonical groups
  const type = rawType === "i18n" ? "feat"
             : rawType === "harden" ? "chore"
             : rawType === "diag" ? "fix"
             : rawType.toLowerCase();

  if (!["feat", "fix", "polish", "chore"].includes(type)) return null;

  return {
    sha,
    shortSha: sha.slice(0, 7),
    month,
    subject,
    type,
    scope,
    title: title.replace(/\s*\(#\d+\)\s*$/, "").trim(),
  };
}

export function getChangelog(): ChangelogMonth[] {
  let raw: string;
  try {
    const repoRoot = path.resolve(process.cwd());
    raw = execSync(
      `git -C "${repoRoot}" log --pretty=format:"%H|%ad|%s" --date=format:"%Y-%m"`,
      { encoding: "utf8", timeout: 10_000 },
    ).trim();
  } catch {
    // Not a git repo or git not available (e.g. Vercel deployment without git history).
    return [];
  }

  const entries: ChangelogEntry[] = raw
    .split("\n")
    .map(parseEntry)
    .filter((e): e is ChangelogEntry => e !== null);

  // Group by month, most recent first
  const byMonth = new Map<string, ChangelogEntry[]>();
  for (const entry of entries) {
    const list = byMonth.get(entry.month) ?? [];
    list.push(entry);
    byMonth.set(entry.month, list);
  }

  const months: ChangelogMonth[] = Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({
      key,
      label: formatMonthLabel(key),
      entries: list.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9)),
    }));

  return months;
}
