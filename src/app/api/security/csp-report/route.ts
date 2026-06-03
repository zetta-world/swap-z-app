import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientId } from "@/lib/rate-limit";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

// CSP violations can come in bursts when a misconfigured external script
// hits multiple checks (e.g. a single third-party script triggering
// script-src + connect-src + img-src in a single page load). 60/min is
// generous for legitimate cases and stops a malicious script from
// DoS'ing our function quotas via thousands of bogus reports.
const RL_OPTS = { windowMs: 60_000, max: 60 };

interface CspReport {
  "csp-report"?: {
    "document-uri"?:     string;
    "violated-directive"?: string;
    "blocked-uri"?:       string;
    "source-file"?:       string;
    "line-number"?:       number;
    "column-number"?:     number;
  };
  // Modern Reporting API uses a different shape — array of report objects.
  type?: string;
  body?: {
    documentURL?:        string;
    blockedURL?:         string;
    effectiveDirective?: string;
    statusCode?:         number;
    sourceFile?:         string;
    lineNumber?:         number;
    columnNumber?:       number;
  };
}

/**
 * POST /api/security/csp-report
 *
 * Receives CSP violation reports from the browser. Both the legacy
 * `report-uri` body shape and the modern Reporting-API array shape are
 * accepted — modern Chromium prefers the latter, older browsers still
 * use the former.
 *
 * What we DO:
 *   - Rate-limit per IP (60/min).
 *   - Normalize both shapes into a single log line that goes to Vercel
 *     function logs — searchable, scoped to the project, no PII.
 *   - Return 204 No Content to keep the browser quiet.
 *
 * What we deliberately DON'T do:
 *   - Forward to a 3rd-party sink (Sentry, Datadog, etc.). Avoids
 *     leaking referrer URLs into surveillance pipelines that the user
 *     didn't consent to.
 *   - Persist anywhere. The function logs are the system of record.
 *   - Echo any of the report content back to the client.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`csp_report:${getClientId(req.headers)}`, RL_OPTS);
  if (!rl.ok) {
    return new NextResponse(null, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    // Some browsers send the body with the wrong content-type but still
    // valid JSON. Try the text fallback before giving up.
    try {
      const text = await req.text();
      raw = JSON.parse(text);
    } catch {
      return new NextResponse(null, { status: 400 });
    }
  }

  // Reporting API ships an array of {type, body, age, url, user_agent}.
  const reports: CspReport[] = Array.isArray(raw)
    ? raw as CspReport[]
    : [raw as CspReport];

  for (const r of reports) {
    if (r.type === "csp-violation" || r.body) {
      const b = r.body ?? {};
      console.warn(
        "[csp] reporting-api violation:",
        truncate(b.effectiveDirective ?? "?"),
        "blocked:", truncate(b.blockedURL ?? "?"),
        "doc:",     truncate(b.documentURL ?? "?"),
        "at:",      truncate(`${b.sourceFile ?? "?"}:${b.lineNumber ?? "?"}:${b.columnNumber ?? "?"}`),
      );
    } else if (r["csp-report"]) {
      const b = r["csp-report"];
      console.warn(
        "[csp] legacy violation:",
        truncate(b["violated-directive"] ?? "?"),
        "blocked:", truncate(b["blocked-uri"] ?? "?"),
        "doc:",     truncate(b["document-uri"] ?? "?"),
        "at:",      truncate(`${b["source-file"] ?? "?"}:${b["line-number"] ?? "?"}:${b["column-number"] ?? "?"}`),
      );
    }
  }

  return new NextResponse(null, { status: 204 });
}

function truncate(s: string): string {
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}
