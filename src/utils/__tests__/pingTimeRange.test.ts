import { describe, expect, it } from "vitest";
import { previousBeijingEvening, resolveBeijingRange } from "../pingTimeRange";
import { normalizeHomepagePingTaskOrder } from "../pingTasks";

describe("custom Ping range", () => {
  it("defaults to the previous Beijing evening across UTC date boundaries", () => {
    const draft = previousBeijingEvening(new Date("2026-01-01T17:00:00Z"));
    expect(draft).toEqual({ start: "2026-01-01T18:00", end: "2026-01-02T00:00" });
    expect(resolveBeijingRange(draft)).toEqual({ start: "2026-01-01T10:00:00.000Z", end: "2026-01-01T16:00:00.000Z" });
  });
  it("rejects reversed and invalid ranges", () => {
    expect(resolveBeijingRange({ start: "", end: "" })).toBeNull();
    expect(resolveBeijingRange({ start: "2026-01-02T00:00", end: "2026-01-01T00:00" })).toBeNull();
  });
});

describe("per VPS Ping order", () => {
  it("keeps independent explicit orders and migrates older bindings", () => {
    const bindings = { 1: ["a", "b"], 2: ["a", "b"], 3: ["a"] };
    expect(normalizeHomepagePingTaskOrder({ a: [3, 1, 3, 99], b: [2, 1] }, bindings)).toEqual({ a: [3, 1, 2], b: [2, 1] });
    expect(normalizeHomepagePingTaskOrder(undefined, bindings)).toEqual({ a: [1, 2, 3], b: [1, 2] });
  });
});
