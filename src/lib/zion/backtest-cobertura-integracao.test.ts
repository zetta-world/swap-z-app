import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const io = vi.hoisted(() => ({ rows: [] as unknown[], update: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getSupabaseAdmin: () => ({
  from: () => ({
    select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: io.rows }) }) }) }),
    update: io.update,
  }),
}) }));
vi.mock("@/lib/admin/track", () => ({ recordEvent: io.event }));
vi.mock("@/lib/api/cex-spot", () => ({ getCexSpotPrices: () => { throw new Error("spot cannot reconstruct a path"); } }));
import { resolveOpenSuggestions } from "./backtest";

const start = Date.parse("2026-11-06T00:00:00Z");
const M = 60_000;
const bar = (t: number, high = 104) => [t, "100", String(high), "99", "102"];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(start + 20 * M);
  io.rows = [{ id: "suggestion", symbol: "BTC", side: "buy", ref_price: 100,
    target_price: 110, stop_price: 95, horizon_hours: 3,
    created_at: new Date(start + 30_000).toISOString(), chain: null, pool_address: null }];
  io.update.mockReturnValue({ eq: async () => ({ error: null }) });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true,
    json: async () => [bar(start), bar(start + 5 * M, 112)] }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("provider to tournament resolver coverage", () => {
  it("requests the partial entry bar and resolves only a later closed touch", async () => {
    expect(await resolveOpenSuggestions()).toEqual({ checked: 1, resolved: 1 });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain(`startTime=${start}&`);
    expect(io.update).toHaveBeenCalledWith(expect.objectContaining({
      status: "hit_target", resolved_price: 110, outcome_pct: 10,
    }));
  });
  it("does not write a profitable touch when the entry interval is missing", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true,
      json: async () => [bar(start + 5 * M, 112)] } as Response);
    expect(await resolveOpenSuggestions()).toEqual({ checked: 1, resolved: 0 });
    expect(io.update).not.toHaveBeenCalled();
  });
  it("does not count a database-rejected close as resolved", async () => {
    io.update.mockReturnValue({ eq: async () => ({ error: { message: "rejected" } }) });
    expect(await resolveOpenSuggestions()).toEqual({ checked: 1, resolved: 0 });
  });
});
