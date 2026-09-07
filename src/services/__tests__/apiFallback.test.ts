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
  getComparisonLoadRecords,
  getComparisonPingRecords,
  getLoadRecords,
  getRealtimeDelta,
  getRealtimeUpdate,
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
    rpcCall.mockRejectedValueOnce(error);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(getLoadRecords("node-a", 1)).rejects.toBe(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("queries a comparison client set once for all load metrics", async () => {
    rpcCall.mockResolvedValueOnce({
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

    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall.mock.calls[0]?.[1]).toMatchObject({
      uuids: ["node-a", "node-b"],
      type: "load",
      load_type: "all",
    });
    expect(result["node-a"]).toHaveLength(1);
    expect(result["node-b"]?.[0]?.cpu).toBe(20);
  });

  it("queries a comparison client set once for ping history", async () => {
    rpcCall.mockResolvedValueOnce({
      count: 2,
      records: {
        "node-a": [{ client: "node-a", task_id: 7, time: 1, value: 10 }],
        "node-b": [{ client: "node-b", task_id: 7, time: 2, value: 20 }],
      },
      tasks: [{ id: 7, name: "edge" }],
    });

    const result = await getComparisonPingRecords({ uuids: ["node-a", "node-b"], hours: 6 });

    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall.mock.calls[0]?.[1]).toMatchObject({
      uuids: ["node-a", "node-b"],
      type: "ping",
    });
    expect(result.records.map((record) => record.client)).toEqual(["node-a", "node-b"]);
    expect(result.tasks[0]?.id).toBe(7);
  });
});
