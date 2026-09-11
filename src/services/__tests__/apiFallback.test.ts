import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcCall, rpcCallHttp } = vi.hoisted(() => ({ rpcCall: vi.fn(), rpcCallHttp: vi.fn() }));

vi.mock("@/services/rpc2Client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/rpc2Client")>();
  return {
    ...actual,
    getRpc2Client: () => ({ call: rpcCall, callHttp: rpcCallHttp }),
  };
});

import {
  getAdminClients,
  getAdminPingTasks,
  getComparisonLoadRecords,
  getComparisonPingRecords,
  getLoadRecords,
  getMe,
  getNodes,
  getPingOverview,
  getPingRecords,
  getPublic,
  getRealtimeDelta,
  getRealtimeUpdate,
  getPingOverviewForNodes,
  saveThemeSettings,
} from "@/services/api";
import {
  RpcProtocolError,
  RpcResponseError,
  RpcTransportError,
} from "@/services/rpc2Client";
import { resetRpcCapabilityCacheForTests } from "@/services/rpcCapabilities";
import { resetKomariBackendProfileForTests } from "@/services/backendProfile";

describe("RPC compatibility fallback", () => {
  beforeEach(() => {
    rpcCall.mockReset();
    rpcCallHttp.mockReset();
    resetRpcCapabilityCacheForTests();
    resetKomariBackendProfileForTests();
    vi.unstubAllGlobals();
  });

  it("keeps the realtime long poll on HTTP so ordinary WebSocket RPC is never head-of-line blocked", async () => {
    rpcCall.mockResolvedValueOnce({
      jsonrpc_version: "2.0",
      contract: "komari.rpc.v2.4",
      methods: ["common:getRealtimeDelta"],
      capabilities: { "realtime.delta": "1", "ping.overview": "2" },
    });
    rpcCallHttp.mockResolvedValueOnce({ sequence: 8, snapshot: false, reports: {} });

    const result = await getRealtimeDelta(7, ["node-a"], { waitMs: 25_000 });

    expect(result.sequence).toBe(8);
    expect(rpcCallHttp).toHaveBeenCalledWith(
      "common:getRealtimeDelta",
      expect.objectContaining({ since: 7, wait_ms: 25_000 }),
      expect.objectContaining({ httpOnly: true }),
    );
    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall).toHaveBeenCalledWith("rpc.discover", {});
  });

  it("normalizes official current-state polling into a full realtime snapshot", async () => {
    rpcCall
      .mockRejectedValueOnce(new RpcResponseError("method not found", -32601))
      .mockResolvedValueOnce([
        "common:getNodesLatestStatus",
        "public:getPublicPingTasks",
        "public:queryMetrics",
        "public:getPingMetricStats",
      ])
      .mockResolvedValueOnce({
        "node-a": { online: true, cpu: 9, ram: 128, ram_total: 256 },
      });

    const result = await getRealtimeUpdate(7, ["node-a", "node-a"], {
      timeout: 12_000,
    });

    expect(result).toMatchObject({
      backend: "official-v1.4",
      mode: "poll",
      delta: {
        sequence: 8,
        snapshot: true,
        reports: { "node-a": { online: true, cpu: 9 } },
      },
    });
    expect(rpcCallHttp).not.toHaveBeenCalled();
    expect(rpcCall).toHaveBeenNthCalledWith(1, "rpc.discover", {});
    expect(rpcCall).toHaveBeenNthCalledWith(2, "rpc.methods", { internal: true });
    expect(rpcCall).toHaveBeenNthCalledWith(
      3,
      "common:getNodesLatestStatus",
      { uuids: ["node-a"] },
      expect.objectContaining({ timeout: 12_000 }),
    );
  });

  it("keeps every official poll as a full snapshot when a node disappears from latest status", async () => {
    let latestStatusPoll = 0;
    rpcCall.mockImplementation((method: string) => {
      if (method === "rpc.discover") {
        return Promise.reject(new RpcResponseError("method not found", -32601));
      }
      if (method === "rpc.methods") {
        return Promise.resolve([
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (method === "common:getNodesLatestStatus") {
        latestStatusPoll += 1;
        return Promise.resolve(latestStatusPoll === 1
          ? { "node-a": { online: true, cpu: 9 } }
          : {});
      }
      throw new Error(`unexpected method ${method}`);
    });

    const first = await getRealtimeUpdate(7, ["node-a", "node-b"]);
    const second = await getRealtimeUpdate(first.delta.sequence, ["node-a", "node-b"]);

    expect(first.delta).toMatchObject({
      sequence: 8,
      snapshot: true,
      reports: { "node-a": { online: true } },
    });
    expect(second.delta).toEqual({
      sequence: 9,
      snapshot: true,
      reports: {},
    });
    expect(rpcCall.mock.calls.filter(([method]) => method === "common:getNodesLatestStatus"))
      .toEqual([
        [
          "common:getNodesLatestStatus",
          { uuids: ["node-a", "node-b"] },
          { timeout: undefined, signal: undefined },
        ],
        [
          "common:getNodesLatestStatus",
          { uuids: ["node-a", "node-b"] },
          { timeout: undefined, signal: undefined },
        ],
      ]);
    expect(rpcCall.mock.calls.map(([method]) => method)).not.toContain("common:getRealtimeDelta");
    expect(rpcCallHttp).not.toHaveBeenCalled();
  });

  it("accepts official REST envelopes while retaining the raw /api/me endpoint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
      const url = new URL(rawUrl, "https://fixture.local");
      const envelope = (data: unknown) => new Response(JSON.stringify({
        status: "success",
        message: "ok",
        data,
      }), { status: 200, headers: { "Content-Type": "application/json" } });

      switch (url.pathname) {
        case "/api/me":
          return new Response(JSON.stringify({ logged_in: true, username: "admin", uuid: "owner" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        case "/api/public":
          return envelope({
            sitename: "Official Komari",
            theme: "Aster",
            theme_settings: { compactShowTrafficTotal: true },
          });
        case "/api/nodes":
          return envelope([{ uuid: "node-a", name: "Official node" }]);
        case "/api/admin/client/list":
          return envelope([{ uuid: "node-a", provider: "Example" }]);
        case "/api/admin/ping":
          return envelope([{ id: 3, name: "Edge" }]);
        case "/api/admin/theme/settings":
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toEqual({ compactShowTrafficTotal: true });
          expect(url.searchParams.get("theme")).toBe("Aster official");
          return new Response(JSON.stringify({ status: "success", message: "saved" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        default:
          throw new Error(`unexpected REST path ${url.pathname}`);
      }
    });
    vi.stubGlobal("fetch", fetchMock);

    const [me, publicConfig, nodes, clients, tasks] = await Promise.all([
      getMe(),
      getPublic(),
      getNodes(),
      getAdminClients(),
      getAdminPingTasks(),
    ]);
    await saveThemeSettings("Aster official", { compactShowTrafficTotal: true });

    expect(me).toMatchObject({ logged_in: true, username: "admin", uuid: "owner" });
    expect(publicConfig).toMatchObject({
      sitename: "Official Komari",
      theme_settings: { compactShowTrafficTotal: true },
    });
    expect(nodes).toEqual([expect.objectContaining({ uuid: "node-a", name: "Official node" })]);
    expect(clients).toEqual([expect.objectContaining({ uuid: "node-a", provider: "Example" })]);
    expect(tasks).toEqual([expect.objectContaining({ id: 3, name: "Edge" })]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("uses upstream metric batches instead of the fork-only multi-node records extension", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "rpc.discover") {
        return Promise.reject(new RpcResponseError("method not found", -32601));
      }
      if (method === "rpc.methods") {
        return Promise.resolve([
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve({
          series: [{
            metric_key: "cpu.usage",
            entity_id: "node-a",
            points: [{ time: "2026-01-01T00:00:00.000Z", value: 12, count: 1 }],
          }],
        });
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await getComparisonLoadRecords({
      uuids: ["node-a", "node-b"],
      hours: 6,
      loadType: "cpu",
    });

    const metricCall = rpcCall.mock.calls.find(([method]) => method === "public:queryMetrics");
    expect(metricCall?.[1]).toMatchObject({
      entity_ids: ["node-a", "node-b"],
      metric_keys: ["cpu.usage"],
    });
    expect(rpcCall.mock.calls.map(([method]) => method)).not.toContain("common:getRecords");
    expect(result["node-a"]?.[0]?.cpu).toBe(12);
    expect(result["node-b"]).toEqual([]);
  });

  it("routes homepage multi-task ping summaries through upstream public metrics", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "rpc.discover") {
        return Promise.reject(new RpcResponseError("method not found", -32601));
      }
      if (method === "rpc.methods") {
        return Promise.resolve([
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([{ id: 8, name: "Edge", clients: ["node-a"], interval: 60 }]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve({
          series: [{
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "8" },
            points: [{ time: "2026-01-01T00:00:00.000Z", value: 25, count: 1 }],
          }],
        });
      }
      if (method === "public:getPingMetricStats") {
        return Promise.resolve({ stats: [] });
      }
      throw new Error(`unexpected method ${method}`);
    });

    const result = await getPingOverviewForNodes(["node-a"]);

    expect(result.tasks).toEqual([expect.objectContaining({ id: 8, name: "Edge" })]);
    expect(rpcCall.mock.calls.map(([method]) => method)).not.toContain("common:getPingOverview");
    expect(result.series["node-a"]?.["8"]?.[0]).toMatchObject({ value: 25 });
  });

  it("routes single-node instance history through the official metric adapter", async () => {
    rpcCall.mockImplementation((method: string, params?: Record<string, unknown>) => {
      if (method === "rpc.discover") {
        return Promise.reject(new RpcResponseError("method not found", -32601));
      }
      if (method === "rpc.methods") {
        return Promise.resolve([
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([{ id: 8, name: "Edge", clients: ["node-a"], interval: 60 }]);
      }
      if (method === "public:queryMetrics") {
        const metricKeys = params?.metric_keys as string[] | undefined;
        if (metricKeys?.includes("cpu.usage")) {
          return Promise.resolve({
            series: [{
              metric_key: "cpu.usage",
              entity_id: "node-a",
              points: [{ time: "2026-01-01T00:00:00.000Z", value: 12, count: 1 }],
            }],
          });
        }
        return Promise.resolve({
          series: [{
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "8" },
            points: [{ time: "2026-01-01T00:00:00.000Z", value: 25, count: 1 }],
          }],
        });
      }
      throw new Error(`unexpected method ${method}`);
    });

    const [load, ping] = await Promise.all([
      getLoadRecords("node-a", 1),
      getPingRecords("node-a", 1),
    ]);

    expect(load.records[0]).toMatchObject({ client: "node-a", cpu: 12 });
    expect(ping.records[0]).toMatchObject({ client: "node-a", task_id: 8, value: 25 });
    expect(ping.tasks).toEqual([expect.objectContaining({ id: 8, name: "Edge" })]);
    expect(rpcCall.mock.calls.map(([method]) => method)).not.toContain("common:getRecords");
  });

  it("keeps the legacy ping-overview helper functional on an official backend", async () => {
    rpcCall.mockImplementation((method: string) => {
      if (method === "rpc.discover") {
        return Promise.reject(new RpcResponseError("method not found", -32601));
      }
      if (method === "rpc.methods") {
        return Promise.resolve([
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (method === "public:getPublicPingTasks") {
        return Promise.resolve([{ id: 8, name: "Edge", clients: ["node-a"], interval: 60 }]);
      }
      if (method === "public:queryMetrics") {
        return Promise.resolve({
          series: [{
            metric_key: "ping.latency_ms",
            entity_id: "node-a",
            tags: { task_id: "8" },
            points: [{ time: "2026-01-01T00:00:00.000Z", value: 25, count: 1 }],
          }],
        });
      }
      throw new Error(`unexpected method ${method}`);
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { uuid: "node-a" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } })));

    const overview = await getPingOverview(1, 8);

    expect(overview.records).toEqual([expect.objectContaining({ client: "node-a", task_id: 8 })]);
    expect(overview.tasks).toEqual([expect.objectContaining({ id: 8, name: "Edge" })]);
    expect(rpcCall.mock.calls.map(([method]) => method)).not.toContain("common:getRecords");
  });

  it("falls back to legacy HTTP only for a typed transport failure", async () => {
    rpcCall.mockRejectedValueOnce(new RpcTransportError("offline"));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      count: 1,
      records: [{ time: 1, cpu: 3 }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await getLoadRecords("node-a", 1);

    expect(result.count).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    new RpcResponseError("method not found", -32601),
    new RpcProtocolError("invalid response"),
    new Error("schema mismatch"),
  ])("does not hide a server or protocol defect behind REST: %s", async (error) => {
    rpcCall
      .mockResolvedValueOnce({
        jsonrpc_version: "2.0",
        contract: "komari.rpc.v2.4",
        methods: ["common:getRecords"],
        capabilities: {},
      })
      .mockRejectedValueOnce(error);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLoadRecords("node-a", 1)).rejects.toBe(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queries a comparison client set once for all load metrics", async () => {
    rpcCall
      .mockResolvedValueOnce({
        jsonrpc_version: "2.0",
        contract: "komari.rpc.v2.4",
        methods: ["common:getRecords"],
        capabilities: {},
      })
      .mockResolvedValueOnce({
        count: 2,
        records: {
          "node-a": [{ client: "node-a", time: 1, cpu: 10 }],
          "node-b": [{ client: "node-b", time: 2, cpu: 20 }],
        },
      });

    const result = await getComparisonLoadRecords({
      uuids: ["node-a", "node-b", "node-a"],
      hours: 6,
      loadType: "all",
    });

    expect(rpcCall).toHaveBeenCalledTimes(2);
    expect(rpcCall.mock.calls[1]?.[1]).toMatchObject({
      uuids: ["node-a", "node-b"],
      type: "load",
      load_type: "all",
    });
    expect(result["node-a"]).toHaveLength(1);
    expect(result["node-b"]?.[0]?.cpu).toBe(20);
  });

  it("queries a comparison client set once for ping history", async () => {
    rpcCall
      .mockResolvedValueOnce({
        jsonrpc_version: "2.0",
        contract: "komari.rpc.v2.4",
        methods: ["common:getRecords"],
        capabilities: {},
      })
      .mockResolvedValueOnce({
        count: 2,
        records: {
          "node-a": [{ client: "node-a", task_id: 7, time: 1, value: 10 }],
          "node-b": [{ client: "node-b", task_id: 7, time: 2, value: 20 }],
        },
        tasks: [{ id: 7, name: "edge" }],
      });

    const result = await getComparisonPingRecords({ uuids: ["node-a", "node-b"], hours: 6 });

    expect(rpcCall).toHaveBeenCalledTimes(2);
    expect(rpcCall.mock.calls[1]?.[1]).toMatchObject({
      uuids: ["node-a", "node-b"],
      type: "ping",
    });
    expect(result.records.map((record) => record.client)).toEqual(["node-a", "node-b"]);
    expect(result.tasks[0]?.id).toBe(7);
  });
});
