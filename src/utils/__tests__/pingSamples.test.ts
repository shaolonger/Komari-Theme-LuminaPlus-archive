import { describe, expect, it } from "vitest";
import {
  getPingRecordSampleCounts,
  isLostPingSample,
  isValidPingLatency,
} from "@/utils/pingSamples";

describe("ping sample predicates", () => {
  it("only treats finite positive RTT values as successful ping latency", () => {
    expect(isValidPingLatency(0.1)).toBe(true);
    expect(isValidPingLatency(1)).toBe(true);
    expect(isValidPingLatency(0)).toBe(false);
    expect(isValidPingLatency(-1)).toBe(false);
    expect(isValidPingLatency(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidPingLatency(null)).toBe(false);
  });

  it("treats zero, negative and non-finite samples as packet loss", () => {
    expect(isLostPingSample(0)).toBe(true);
    expect(isLostPingSample(-1)).toBe(true);
    expect(isLostPingSample(Number.NaN)).toBe(true);
    expect(isLostPingSample(12)).toBe(false);
  });

  it("keeps explicit rollup loss counts instead of inferring loss from the displayed RTT", () => {
    expect(getPingRecordSampleCounts({ value: 42, sample_count: 20, loss_count: 3 }))
      .toEqual({ total: 20, lost: 3, valid: 17 });
    expect(getPingRecordSampleCounts({ value: -1, sample_count: 5 }))
      .toEqual({ total: 5, lost: 5, valid: 0 });
    expect(getPingRecordSampleCounts({ value: 8, loss_count: 9 }))
      .toEqual({ total: 1, lost: 1, valid: 0 });
  });
});
