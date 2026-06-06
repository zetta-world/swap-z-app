import type { ChangelogMonth } from "@/lib/changelog";
import { cn } from "@/lib/cn";

const TYPE_LABEL: Record<string, string> = {
  feat:   "feat",
  polish: "polish",
  fix:    "fix",
  chore:  "chore",
};

const TYPE_CLASSES: Record<string, string> = {
  feat:   "text-cyan   border-cyan/30   bg-cyan/[0.06]",
  polish: "text-violet border-violet/30 bg-violet/[0.06]",
  fix:    "text-gold   border-gold/30   bg-gold/[0.06]",
  chore:  "text-ink-3  border-white/10  bg-white/[0.02]",
};

const DOT_CLASSES: Record<string, string> = {
  feat:   "bg-cyan",
  polish: "bg-violet",
  fix:    "bg-gold",
  chore:  "bg-white/20",
};

interface Props {
  months: ChangelogMonth[];
}

export default function ChangelogView({ months }: Props) {
  if (months.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="font-mono text-sm text-ink-3">
          No changelog data — git history not available in this environment.
        </p>
      </div>
    );
  }

  const totalEntries = months.reduce((s, m) => s + m.entries.length, 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <span className="tag tag-cyan section-label">Build log</span>
          <span className="tag tag-violet section-label">{totalEntries} commits</span>
        </div>
        <h1 className="font-display font-extrabold text-3xl text-ink mb-2">
          Changelog
        </h1>
        <p className="font-mono text-[12px] text-ink-3">
          Auto-generated from git history · filtered to{" "}
          <code className="text-cyan">feat / polish / fix / chore</code>
          {" "}· grouped by month
        </p>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/[0.06]" />

        <div className="space-y-8">
          {months.map((month) => (
            <div key={month.key}>
              {/* Month label */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-3.5 h-3.5 rounded-full border border-cyan/40 bg-cyan/10 flex-shrink-0 relative z-10" />
                <h2 className="font-display font-bold text-sm text-ink tracking-wide">
                  {month.label}
                  <span className="ml-2 font-mono text-[10px] text-ink-4 font-normal">
                    {month.entries.length} changes
                  </span>
                </h2>
              </div>

              {/* Entries */}
              <div className="ml-7 space-y-2">
                {month.entries.map((entry) => (
                  <div
                    key={entry.sha}
                    className="glass rounded-xl p-3 flex items-start gap-3 group"
                  >
                    {/* Dot */}
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5",
                      DOT_CLASSES[entry.type] ?? "bg-white/20",
                    )} />

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        {/* Type badge */}
                        <span className={cn(
                          "tag text-[9px] flex-shrink-0",
                          TYPE_CLASSES[entry.type] ?? "text-ink-3 border-white/10 bg-white/[0.02]",
                        )}>
                          {TYPE_LABEL[entry.type] ?? entry.type}
                          {entry.scope && (
                            <span className="opacity-70">({entry.scope})</span>
                          )}
                        </span>
                        {/* Title */}
                        <span className="font-display font-bold text-sm text-ink leading-snug">
                          {entry.title}
                        </span>
                      </div>
                    </div>

                    {/* SHA */}
                    <code className="font-mono text-[9px] text-ink-4 flex-shrink-0 mt-0.5 hidden sm:block group-hover:text-ink-3 transition-colors">
                      {entry.shortSha}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="font-mono text-[10px] text-ink-4 text-center mt-12">
        Generated at build time · <code>git log --pretty=format:&quot;%H|%ad|%s&quot;</code>
      </p>
    </div>
  );
}
