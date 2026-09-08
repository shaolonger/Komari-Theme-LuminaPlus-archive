import { describe, expect, it } from "vitest";
import {
  buildHomepagePingCompareUrl,
  buildHomepagePingSourceRows,
} from "@/utils/homepagePingSources";

describe("homepage Ping source helpers", () => {
  it("formats source rows with groups and status", () => {
    const rows = buildHomepagePingSourceRows(
      {
        taskSummaries: [
          {
            taskId: 2,
            name: "Google",
            target: "8.8.8.8",
            lastValue: 42.345,
            loss: 0,
            sampleCount: 8,
            hasSamples: true,
            samples: [{ time: 1_000, value: 42.345 }],
          },
          {
            taskId: 5,
            name: "Los Angeles",
            target: "15.253.0.254",
            lastValue: 420.345,
            loss: 6.345,
            sampleCount: 8,
            hasSamples: true,
          },
        ],
      },
      { 5: "海外" },
      [5, 2],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        taskId: 5,
        group: "海外",
        latencyMs: 420.345,
        lossPercent: 6.345,
        latencyLabel: "420.35 ms",
        latencyShortLabel: "420.35",
        lossLabel: "6.35%",
        lossShortLabel: "6.35",
        lossDotCount: 4,
        status: "warning",
      }),
      expect.objectContaining({
        taskId: 2,
        latencyMs: 42.345,
        lossPercent: 0,
        latencyLabel: "42.35 ms",
        latencyShortLabel: "42.35",
        lossLabel: "0.00%",
        lossShortLabel: "0.00",
        lossDotCount: 0,
        status: "ok",
        samples: [{ time: 1_000, value: 42.345 }],
      }),
    ]);
    expect(rows[0].attentionScore).toBeGreaterThan(rows[1].attentionScore);
    expect(rows[0].latencyRatio).toBeGreaterThan(rows[1].latencyRatio);
    expect(rows[0].title).toContain("Los Angeles · 海外");
    expect(rows[0].title).toContain("近 1 小时丢包 6.35%");
  });

  it("keeps same-attention rows in source order and models empty sources", () => {
    const rows = buildHomepagePingSourceRows({
      taskSummaries: [
        {
          taskId: 7,
          name: "No samples",
          target: "",
          lastValue: null,
          loss: null,
          sampleCount: 0,
          hasSamples: false,
        },
        {
          taskId: 8,
          name: "Also empty",
          target: "",
          lastValue: null,
          loss: null,
          sampleCount: 0,
          hasSamples: false,
        },
      ],
    });

    expect(rows.map((row) => row.taskId)).toEqual([7, 8]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        latencyLabel: "无有效延迟",
        latencyShortLabel: "—",
        lossLabel: "未知",
        lossShortLabel: "—",
        latencyRatio: 0,
        lossDotCount: 0,
        status: "empty",
      }),
    );
  });

  it("keeps configured source order regardless of changing risk", () => {
    const rows = buildHomepagePingSourceRows({
      taskSummaries: [
        {
          taskId: 1,
          name: "Healthy",
          target: "",
          lastValue: 38,
          loss: 0,
          sampleCount: 12,
          hasSamples: true,
        },
        {
          taskId: 2,
          name: "Empty",
          target: "",
          lastValue: null,
          loss: null,
          sampleCount: 0,
          hasSamples: false,
        },
        {
          taskId: 3,
          name: "Slow",
          target: "",
          lastValue: 360,
          loss: 0,
          sampleCount: 12,
          hasSamples: true,
        },
        {
          taskId: 4,
          name: "Lossy",
          target: "",
          lastValue: 80,
          loss: 25,
          sampleCount: 12,
          hasSamples: true,
        },
      ],
    });

    expect(rows.map((row) => row.taskId)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => row.status)).toEqual(["ok", "empty", "warning", "critical"]);
    expect(rows[3].title).toContain("严重");
  });

  it("maps packet loss to discrete dot levels", () => {
    const rows = buildHomepagePingSourceRows({
      taskSummaries: [0, 0.5, 2, 4, 8, 20].map((loss, index) => ({
        taskId: index + 1,
        name: `Loss ${loss}`,
        target: "",
        lastValue: 40,
        loss,
        sampleCount: 12,
        hasSamples: true,
      })),
    });
    const dotsByTask = new Map(rows.map((row) => [row.taskId, row.lossDotCount]));

    expect(dotsByTask).toEqual(new Map([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
    ]));
  });

  it("keeps latency visual ratios bounded for tiny and extreme values", () => {
    const rows = buildHomepagePingSourceRows({
      taskSummaries: [
        {
          taskId: 1,
          name: "Tiny",
          target: "",
          lastValue: 1,
          loss: 0,
          sampleCount: 1,
          hasSamples: true,
        },
        {
          taskId: 2,
          name: "Extreme",
          target: "",
          lastValue: 2400,
          loss: 0,
          sampleCount: 1,
          hasSamples: true,
        },
      ],
    });
    const tiny = rows.find((row) => row.taskId === 1);
    const extreme = rows.find((row) => row.taskId === 2);

    expect(tiny?.latencyRatio).toBeGreaterThan(0);
    expect(tiny?.latencyRatio).toBeLessThan(0.1);
    expect(extreme?.latencyRatio).toBe(1);
  });

  it("builds a compare URL for single-VPS multi-task trends", () => {
    expect(buildHomepagePingCompareUrl("node-a", [5, 2, 2])).toBe(
      "/compare?nodes=node-a&metric=ping_latency&hours=1&tab=trend&pingTasks=2%2C5",
    );
  });

  it("omits pingTasks from compare URLs when no valid task IDs exist", () => {
    expect(buildHomepagePingCompareUrl("node-a", [0, -1, Number.NaN])).toBe(
      "/compare?nodes=node-a&metric=ping_latency&hours=1&tab=trend",
    );
  });
});
