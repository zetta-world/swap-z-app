import type { Metadata } from "next";
import AppShell from "@/components/layout/AppShell";
import ChangelogView from "@/components/changelog/ChangelogView";
import { getChangelog } from "@/lib/changelog";

export const metadata: Metadata = {
  title: "Changelog · Z-SWAP",
  description:
    "Z-SWAP build history — features, fixes, and polish sprints, auto-generated from git history.",
};

// Re-generate at most once per hour on Vercel ISR; during normal builds
// this just runs at build time and produces a static page.
export const revalidate = 3600;

export default function Page() {
  const months = getChangelog();
  return (
    <AppShell>
      <ChangelogView months={months} />
    </AppShell>
  );
}
