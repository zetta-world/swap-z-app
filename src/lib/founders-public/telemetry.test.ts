import { describe, expect, it } from "vitest";
import { FOUNDERS_PUBLIC_EVENTS, validateFoundersPublicEvent } from "./telemetry";

describe("Founders public telemetry", () => {
  it("accepts the closed event vocabulary without PII", () => {
    for (const event of FOUNDERS_PUBLIC_EVENTS) {
      expect(validateFoundersPublicEvent({ event, path: "/founders-pass", meta: { locale: "pt" } })?.event).toBe(event);
    }
  });

  it("rejects routes, keys, identifiers and free-form search content outside the schema", () => {
    expect(validateFoundersPublicEvent({ event: "faq_open", path: "/pricing" })).toBeNull();
    expect(validateFoundersPublicEvent({ event: "unknown", path: "/founders-pass" })).toBeNull();
    expect(validateFoundersPublicEvent({ event: "faq_search", path: "/founders-pass", meta: { query: "wallet address" } })).toBeNull();
    expect(validateFoundersPublicEvent({ event: "faq_open", path: "/founders-pass", meta: { faq: "../secret" } })).toBeNull();
    expect(validateFoundersPublicEvent({ event: "faq_search", path: "/founders-pass", meta: { queryLength: 10_001 } })).toBeNull();
  });
});
