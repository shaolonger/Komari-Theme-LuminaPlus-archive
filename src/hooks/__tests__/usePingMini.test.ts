import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/api", () => ({
	getPingOverviewForNodes: vi.fn(),
}));

import { buildHomepagePingOverviewMap, buildPingOverviewBuckets } from "@/hooks/usePingMini";
import { getPingOverviewForNodes } from "@/services/api";

const mockedGetPingOverview = vi.mocked(getPingOverviewForNodes);

describe("buildHomepagePingOverviewMap", () => {
  beforeEach(() => {
    mockedGetPingOverview.mockReset();
  });

  it("drops a deleted task when its response contains retained records but no task metadata", async () => {
    mockedGetPingOverview.mockResolvedValue({
	  from: 1_700_000_000,
	  to: 1_700_000_100,
      tasks: [],
	  stats: { "node-a": { "20": { name: "deleted", total: 1, lost: 0, latest: 279, avg: 279, tail: 0, loss: 0, min: 279, max: 279 } } },
	  series: {},
    });

    const result = await buildHomepagePingOverviewMap(
      1,
      ["node-a"],
      { 20: ["node-a"] },
      "worst",
      {},
    );

    expect(result.assignmentKey).toBe("");
    expect(result.items.size).toBe(0);
  });

  it("keeps an active task with its real metadata", async () => {
    mockedGetPingOverview.mockResolvedValue({
	  from: 1_700_000_000,
	  to: 1_700_000_100,
      tasks: [
        {
          id: 3,
          name: "Cloudflare",
          type: "icmp",
          interval: 60,
        },
      ],
	  stats: { "node-a": { "3": { name: "Cloudflare", total: 60, lost: 3, latest: 42, avg: 40, tail: 0.2, loss: 5, min: 30, max: 80 } } },
	  series: { "node-a": { "3": [
	    { time: 1_700_000_000, value: 35, sample_count: 3, loss_count: 0, loss: 0 },
	    { time: 1_700_000_050, value: 50, sample_count: 3, loss_count: 1, loss: 33.3 },
	    { time: 1_700_000_100, value: 42, sample_count: 3, loss_count: 0, loss: 0 },
	  ] } },
    });

    const result = await buildHomepagePingOverviewMap(
      1,
      ["node-a"],
      { 3: ["node-a"] },
      "worst",
      {},
    );

    expect(result.assignmentKey).toBe("node-a:3");
    expect(result.items.get("node-a")).toMatchObject({
      taskIds: [3],
      lastValue: 42,
	  taskSummaries: [expect.objectContaining({ name: "Cloudflare" })],
	  values: [35, 50, 42],
	});
		expect(result.items.get("node-a")?.samples).toEqual([
		  { time: 1_700_000_000_000, value: 35, sampleCount: 3, lossCount: 0 },
		  { time: 1_700_000_050_000, value: 50, sampleCount: 3, lossCount: 1 },
		  { time: 1_700_000_100_000, value: 42, sampleCount: 3, lossCount: 0 },
		]);
  });

  it("keeps a rollup's latency and packet-loss weights in the same visual bucket", () => {
    const now = 1_700_000_000_000;
    const [bucket] = buildPingOverviewBuckets([{
      time: now - 1_000,
      value: 48,
      sampleCount: 5,
      lossCount: 1,
    }], 1, now);

    expect(bucket).toMatchObject({
      value: 48,
      total: 5,
      lost: 1,
      loss: 20,
    });
  });
});
