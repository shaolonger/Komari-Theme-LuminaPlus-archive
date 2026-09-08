import { describe, expect, it } from "vitest";
import {
  cutPeakValues,
  downsampleAligned,
  downsamplePingAligned,
  fillMissingMetricPoints,
  insertMetricGapSentinels,
  type TimedMetricPoint,
} from "@/components/instance/chartData";

describe("fillMissingMetricPoints", () => {
  it("does not erase every day-scale bucket when losses are distributed throughout the day", () => {
    const times = Array.from({ length: 2880 }, (_, index) => index * 30);
    const values = times.map((_, index) => index % 12 === 0 ? null : 50);
    const reduced = downsamplePingAligned(times, [values], 160);
    expect(reduced.perTask[0].filter((v) => v === 50).length).toBeGreaterThan(160);
    expect(reduced.perTask[0].filter((v) => v === null)).toHaveLength(240);
  });
  it("keeps a day of rolled-up Ping points visible and preserves real loss", () => {
    const points = Array.from({ length: 288 }, (_, index) => ({ time: index * 300, ping: index === 100 ? null : 40 + index % 10 }));
    const result = insertMetricGapSentinels(points, { intervals: new Map([["ping", 30]]), inferSamplingInterval: true });
    expect(result).toEqual(points);
    const chart = downsampleAligned(result.map((point) => point.time), [result.map((point) => point.ping)], 160);
    expect(chart.perTask[0].filter((value) => typeof value === "number").length).toBeGreaterThan(150);
    expect(chart.perTask[0]).toContain(null);
  });
  it("keeps the newest sample's own timestamp instead of snapping it to the grid", () => {
    // 末点 (t=35) 不在 10ms 网格上；不能被拉回到 t=30。
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
      { time: 35, v: 9 },
    ];
    const filled = fillMissingMetricPoints(points, { intervalSeconds: 10, matchToleranceSeconds: 5 });
    const last = filled[filled.length - 1];
    expect(last.time).toBe(35);
    expect(last.v).toBe(9);
  });

  it("leaves on-grid series untouched at the trailing edge", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, v: 1 },
      { time: 10, v: 2 },
      { time: 20, v: 3 },
    ];
    const filled = fillMissingMetricPoints(points, { intervalSeconds: 10, matchToleranceSeconds: 5 });
    expect(filled.map((p) => p.time)).toEqual([0, 10, 20]);
    expect(filled[filled.length - 1].v).toBe(3);
  });
});

describe("cutPeakValues", () => {
  it("preserves genuine loss gaps instead of backfilling them (regression)", () => {
    const points = [
      { time: 1, t1: 50 },
      { time: 2, t1: 52 },
      { time: 3, t1: null }, // 丢包——必须保持为空缺
      { time: 4, t1: 51 },
      { time: 5, t1: 50 },
    ];

    const out = cutPeakValues(points, ["t1"]);

    expect(out[2].t1).toBeNull();
    // 周围的采样仍是真实数字 (EWMA 平滑后)，没有被置空。
    expect(typeof out[0].t1).toBe("number");
    expect(typeof out[4].t1).toBe("number");
  });

  it("does not invent values across a multi-point outage", () => {
    const points = [
      { time: 1, t1: 40 },
      { time: 2, t1: null },
      { time: 3, t1: null },
      { time: 4, t1: null },
      { time: 5, t1: 42 },
    ];

    const out = cutPeakValues(points, ["t1"]);

    expect(out[1].t1).toBeNull();
    expect(out[2].t1).toBeNull();
    expect(out[3].t1).toBeNull();
  });
});

describe("insertMetricGapSentinels — three-state ping semantics", () => {
  const opts = (intervals: Record<string, number>) => ({
    intervals: new Map(Object.entries(intervals)),
    matchToleranceRatio: 0.25,
  });
  const at = (points: TimedMetricPoint[], time: number) =>
    points.find((point) => point.time === time);

  it("keeps an off-phase anchor as undefined (spannable), not null", () => {
    // A 和 B 都每 60s 采样但错开 30s，所以各自建的 anchor 对方都没采过。这些 off-phase 格子
    // 必须保持 undefined，uPlot 才会跨过而非切断每条线——正是当初的空白图表 bug。
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 30, B: 20 },
      { time: 60, A: 11 },
      { time: 90, B: 21 },
      { time: 120, A: 12 },
      { time: 150, B: 22 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p0 = at(out, 0)!;
    expect(p0.A).toBe(10);
    expect(p0.B).toBeUndefined();
    const p30 = at(out, 30)!;
    expect(p30.B).toBe(20);
    expect(p30.A).toBeUndefined();
  });

  it("preserves real loss (null) as a break", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 60, A: null }, // value <= 0 已被分桶器编码成 null
      { time: 120, A: 12 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(at(out, 60)!.A).toBeNull();
  });

  it("tolerates a single missed sample (gap <= 2x interval)", () => {
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 120, A: 12 }, // 60 处漏了一个采样 → 空缺正好是 2 倍 interval
      { time: 180, A: 13 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.every((point) => point.A !== null)).toBe(true);
  });

  it("bridges up to two consecutive missed samples (gap <= 3x interval)", () => {
    // 连续漏两次采样 → 空缺正好 3 倍 interval，仍视为抖动/漏采而非中断，保持可跨过(不插 null)。
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 180, A: 13 }, // 60、120 两处漏采 → 空缺 = 3 倍 interval
      { time: 240, A: 14 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.every((point) => point.A !== null)).toBe(true);
  });

  it("breaks once the gap exceeds 3x interval", () => {
    // 空缺 = 4 倍 interval → 真实较长中断，必须插 null 断点。
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10 },
      { time: 240, A: 14 }, // 60、120、180 三处漏采 → 空缺 = 4 倍 interval
      { time: 300, A: 15 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60 }));

    expect(out.some((point) => point.A === null)).toBe(true);
  });

  it("breaks only the gapped task on a long outage, sparing co-located anchors", () => {
    // A 在 60..300 间中断，而 B 持续采样。A 的断点必须落到 B 的 anchor 上 (合并而非跳过)，
    // 且不能破坏 B 的真实值。
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10, B: 100 },
      { time: 60, A: 11, B: 101 },
      { time: 120, B: 102 },
      { time: 180, B: 103 },
      { time: 240, B: 104 },
      { time: 300, A: 15, B: 105 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p120 = at(out, 120)!;
    expect(p120.A).toBeNull(); // A 断开，合并到 B 已有的 anchor 上
    expect(p120.B).toBe(102); // B 不受影响
  });

  it("merges sentinels when multiple tasks gap at the same time", () => {
    // A 和 B 都在 60..300 间中断且其间没有 anchor，所以各自在相同的期望时间播下哨兵——
    // 第二个必须合并而非覆盖。
    const points: TimedMetricPoint[] = [
      { time: 0, A: 10, B: 100 },
      { time: 60, A: 11, B: 101 },
      { time: 300, A: 15, B: 105 },
    ];

    const out = insertMetricGapSentinels(points, opts({ A: 60, B: 60 }));

    const p120 = at(out, 120)!;
    expect(p120).toBeDefined();
    expect(p120!.A).toBeNull();
    expect(p120!.B).toBeNull();
  });
});

describe("downsampleAligned", () => {
  it("keeps a real null break even when the same bucket also contains numeric samples", () => {
    const out = downsampleAligned(
      [0, 10, 20, 30],
      [[10, null, 14, 16]],
      2,
    );

    expect(out.times).toHaveLength(2);
    expect(out.perTask[0][0]).toBeNull();
    expect(out.perTask[0][1]).toBe(15);
  });

  it("keeps off-phase-only buckets undefined", () => {
    const out = downsampleAligned(
      [0, 10, 20, 30],
      [[undefined, undefined, 14, 16]],
      2,
    );

    expect(out.perTask[0][0]).toBeUndefined();
    expect(out.perTask[0][1]).toBe(15);
  });
});
