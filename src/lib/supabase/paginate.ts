/**
 * Fetch EVERY row of a query by paginating in fixed-size chunks.
 *
 * PostgREST (Supabase) silently caps any select at max-rows (default 1000) —
 * no error, just a truncated result. The flywheel's honesty depends on
 * aggregating the WHOLE ledger: the day zion_suggestions crossed 1000 rows,
 * expectancy/win-rate/tournament would silently freeze on an arbitrary
 * 1000-row subset (money-path audit A1).
 *
 * The caller passes a page FACTORY (PostgREST builders are single-use, so a
 * fresh builder per page) that MUST apply a stable `.order()` — paginating an
 * unordered select can skip or duplicate rows between pages.
 */
export async function selectAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  chunkSize = 1000,
  maxRows = 100_000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += chunkSize) {
    const { data } = await page(from, Math.min(from + chunkSize, maxRows) - 1);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < chunkSize) break;
  }
  return out;
}
