import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcCall } = vi.hoisted(() => ({ rpcCall: vi.fn() }));

vi.mock("@/services/rpc2Client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rpc2Client")>();
  return {
    ...actual,
    getRpc2Client: () => ({ call: rpcCall }),
  };
});

import {
  getOfficialComparisonLoadRecords,
  getOfficialComparisonPingRecords,
  getOfficialPingOverviewForNodes,
} from "@/services/officialKomariAdapter";
import { buildComparisonSeries, nodesToComparisonNodes } from "@/utils/vpsCompare";

const NODE = {
  uuid: "node-a",
  name: "A",
  group: "g",
  region: "r",
  hidden: false,
  cpu_name: "",
  cpu_cores: 1,
  arch: "",
  virtualization: "",
  os: "",
  kernel_version: "",
  version: "",
  ipv4: "",
  ipv6: "",
  capability_ping: null,
  capability_private_ping_targets: null,
  gpu_name: "",
  mem_total: 1_000,
  swap_total: 500,
  disk_total: 2_000,
  weight: 0,
  price: 0,
  billing_cycle: "",
  auto_renewal: false,
  currency: "",
  provider: "",
  business_role: "",
  expired_at: "",
  tags: "",
  public_remark: "",
  traffic_limit: 0,
  traffic_limit_type: "",
  created_at: "",
  updated_at: "",
} as const;

function metricResponse(series: unknown[]) {
  return { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T01:00:00.000Z", series };
}

describe("official Komari metric adapter", () => {
  beforeEach(() => {
    rpcCall.mockReset();
  });

  it("reconstructs compact upstream load series with current resource totals", async () => {
    rpcCall.mockResolvedValue(metricResponse([
      {
        metric_key: "cpu.usage",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 25, count: 3 }],
      },
      {
        metric_key: "memory.used",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 500, count: 3 }],
      },
      {
        metric_key: "disk.used",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 800, count: 3 }],
      },
      {
        metric_key: "net.in.rate",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 30, count: 3 }],
      },
      {
        metric_key: "net.out.rate",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 40, count: 3 }],
      },
      {
        metric_key: "net.total.up",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 300, count: 3 }],
      },
      {
        metric_key: "net.total.down",
        entity_id: "node-a",
        points: [{ time: "2026-01-01T00:10:00.000Z", value: 400, count: 3 }],
      },
    ]));

    const records = await getOfficialComparisonLoadRecords({
      uuids: ["node-a"],
      hours: 6,
      loadType: "all",
      nodes: [NODE],
      maxPoints: 72,
      range: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T01:00:00.000Z" },
    });

    expect(rpcCall).toHaveBeenCalledWith(
      "public:queryMetrics",
      expect.objectContaining({
        entity_ids: ["node-a"],
        start: "2026-01-01T00:00:00.000Z",
        end: "2026-01-01T01:00:00.000Z",
        fill_empty: false,
        max_points: 72,
        aggregation_by_metric: {
          "net.total.up": "last",
          "net.total.down": "last",
        },
      }),
      undefined,
    );
    expect(records["node-a"]?.[0]).toMatchObject({
      cpu: 25,
      ram: 500,
      ram_total: 1_000,
      disk: 800,
      disk_total: 2_000,
      net_in: 30,
      net_out: 40,
      net_total_up: 300,
      net_total_down: 400,
    });
  });

  it("keeps a downsampled loss ratio exact for comparison charts", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([{ id: 7, name: "Edge", clients: ["node-a"], type: "icmp", interval: 60 }]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve(metricResponse([
          {
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "7" },
            // Four successful 55ms probes plus one upstream -1 loss sentinel
            // are stored as an all-sample arithmetic mean of 43.8.
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 43.8, count: 5 }],
          },
          {
            metric_key: "ping.loss",
            entity_id: "node-a",
            tags: { task_id: "7" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 0.2, count: 5 }],
          },
        ]));
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await getOfficialComparisonPingRecords({
      uuids: ["node-a"],
      hours: 6,
      maxPoints: 72,
      range: { start: "2026-01-01T00:00:00.000Z", end: "2026-01-01T01:00:00.000Z" },
    });
    const record = result.records[0];
    expect(record).toMatchObject({
      client: "node-a",
      task_id: 7,
      value: 55,
      sample_count: 5,
      loss_count: 1,
      loss_rate: 0.2,
    });
    expect(rpcCall).toHaveBeenCalledWith(
      "public:queryMetrics",
      expect.objectContaining({
        aggregation_by_metric: {
          "ping.latency_ms": "avg",
          "ping.loss": "avg",
        },
      }),
      undefined,
    );

    const series = buildComparisonSeries({
      metricKey: "ping_loss",
      nodes: nodesToComparisonNodes([NODE]),
      pingRecords: result.records,
    });
    expect(series[0]?.points[0]?.value).toBe(20);
  });

  it("keeps same-timestamp metrics for multiple upstream ping tasks separate", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([
          { id: 3, name: "Transit", clients: ["node-a"], type: "icmp", interval: 60 },
          { id: 8, name: "Edge", clients: ["node-a"], type: "tcp", interval: 30 },
        ]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve(metricResponse([
          {
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "3" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 18, count: 1 }],
          },
          {
            metric_key: "ping.loss",
            entity_id: "node-a",
            tags: { task_id: "3" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 0, count: 1 }],
          },
          {
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "8" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: -1, count: 1 }],
          },
          {
            metric_key: "ping.loss",
            entity_id: "node-a",
            tags: { task_id: "8" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 1, count: 1 }],
          },
        ]));
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await getOfficialComparisonPingRecords({
      uuids: ["node-a"],
      hours: 1,
      maxPoints: 24,
    });

    expect(result.tasks.map((task) => [task.id, task.name])).toEqual([
      [3, "Transit"],
      [8, "Edge"],
    ]);
    expect(result.records).toEqual([
      expect.objectContaining({ task_id: 3, value: 18, sample_count: 1, loss_count: 0 }),
      expect.objectContaining({ task_id: 8, value: -1, sample_count: 1, loss_count: 1 }),
    ]);
  });

  it("scopes the official global task catalog to requested nodes and observed history", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([
          { id: 3, name: "Bound", clients: ["node-a"], type: "icmp", interval: 60 },
          { id: 8, name: "Other node", clients: ["node-b"], type: "icmp", interval: 60 },
          { id: 12, name: "Historical", clients: [], type: "tcp", interval: 30 },
        ]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve(metricResponse([
          {
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "12" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 25, count: 1 }],
          },
          {
            metric_key: "ping.loss",
            entity_id: "node-a",
            tags: { task_id: "12" },
            points: [{ time: "2026-01-01T00:10:00.000Z", value: 0, count: 1 }],
          },
        ]));
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await getOfficialComparisonPingRecords({
      uuids: ["node-a"],
      hours: 1,
      maxPoints: 24,
    });

    expect(result.tasks.map((task) => task.id)).toEqual([3, 12]);
    expect(result.records).toEqual([
      expect.objectContaining({ client: "node-a", task_id: 12, value: 25 }),
    ]);
  });

  it("uses one shared one-hour window for official ping tasks, metrics, and stats", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([
          { id: 7, name: "Edge", clients: ["node-a"], type: "icmp", interval: 30 },
          { id: 8, name: "Other node", clients: ["node-b"], type: "icmp", interval: 30 },
        ]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve(metricResponse([
          {
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "7" },
            points: [
              { time: "2026-01-01T00:10:00.000Z", value: 40, count: 5 },
              { time: "2026-01-01T00:20:00.000Z", value: null, count: 5 },
            ],
          },
          {
            metric_key: "ping.loss",
            entity_id: "node-a",
            tags: { task_id: "7" },
            points: [
              { time: "2026-01-01T00:10:00.000Z", value: 0, count: 5 },
              { time: "2026-01-01T00:20:00.000Z", value: 0.2, count: 5 },
            ],
          },
        ]));
      }
      if (method === "public:getPingMetricStats") {
        return Promise.resolve({
          stats: [{
            entity_id: "node-a",
            task_id: "7",
            name: "Edge",
            total: 10,
            valid: 9,
            loss: 10,
            min: 20,
            max: 80,
            avg: 40,
            latest: 40,
            p99_p50_ratio: 0.5,
          }],
        });
      }
      throw new Error(`unexpected method ${method}`);
    });

    const overview = await getOfficialPingOverviewForNodes(["node-a"]);
    const metricCall = rpcCall.mock.calls.find(([method]) => method === "public:queryMetrics");
    const statsCall = rpcCall.mock.calls.find(([method]) => method === "public:getPingMetricStats");

    expect(metricCall?.[1]).toMatchObject({
      entity_ids: ["node-a"],
      metric_keys: ["ping.latency_ms", "ping.loss"],
      fill_empty: true,
      max_points: 24,
    });
    expect(statsCall?.[1]).toMatchObject({ entity_ids: ["node-a"], max_points: 24 });
    const metricParams = metricCall?.[1] as { start: string; end: string };
    const statsParams = statsCall?.[1] as { start: string; end: string };
    expect(metricParams.start).toBe(statsParams.start);
    expect(metricParams.end).toBe(statsParams.end);
    expect(Date.parse(metricParams.end) - Date.parse(metricParams.start)).toBe(60 * 60 * 1_000);
    expect(overview.stats["node-a"]?.["7"]).toMatchObject({ total: 10, lost: 1, loss: 10 });
    expect(overview.tasks.map((task) => task.id)).toEqual([7]);
    expect(overview.series["node-a"]?.["7"]).toEqual([
      { time: "2026-01-01T00:10:00.000Z", value: 40, sample_count: 5, loss_count: 0, loss: 0 },
      { time: "2026-01-01T00:20:00.000Z", value: -1, sample_count: 5, loss_count: 1, loss: 20 },
    ]);
  });
});
