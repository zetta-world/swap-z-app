import { describe, it, expect } from "vitest";
import { selectAllRows } from "./paginate";

function fakeDb(total: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ i }));
  let calls = 0;
  const page = (from: number, to: number) => {
    calls++;
    return Promise.resolve({ data: rows.slice(from, to + 1) });
  };
  return { page, calls: () => calls };
}

describe("selectAllRows — A1: aggregate past PostgREST's silent 1000-row cap", () => {
  it("returns every row when the set spans multiple chunks", async () => {
    const db = fakeDb(2500);
    const out = await selectAllRows(db.page, 1000);
    expect(out).toHaveLength(2500);
    expect(out[2499]).toEqual({ i: 2499 });
    expect(db.calls()).toBe(3);
  });

  it("stops after one call when the set fits a single chunk", async () => {
    const db = fakeDb(40);
    const out = await selectAllRows(db.page, 1000);
    expect(out).toHaveLength(40);
    expect(db.calls()).toBe(1);
  });

  it("returns [] on a null page (db error) without throwing", async () => {
    const out = await selectAllRows(() => Promise.resolve({ data: null }));
    expect(out).toHaveLength(0);
  });

  it("honors the maxRows safety cap", async () => {
    const db = fakeDb(5000);
    const out = await selectAllRows(db.page, 1000, 3000);
    expect(out).toHaveLength(3000);
  });
});
