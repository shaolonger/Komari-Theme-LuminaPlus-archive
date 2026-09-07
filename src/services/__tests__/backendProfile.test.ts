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
  getKomariBackendProfile,
  resetKomariBackendProfileForTests,
} from "@/services/backendProfile";
import { RpcResponseError } from "@/services/rpc2Client";

const OFFICIAL_METHODS = [
  "common:getNodesLatestStatus",
  "public:getPublicPingTasks",
  "public:queryMetrics",
  "public:getPingMetricStats",
];

describe("Komari backend profile detection", () => {
  beforeEach(() => {
    rpcCall.mockReset();
    resetKomariBackendProfileForTests();
  });

  it("uses the fork contract when rpc.discover is available", async () => {
    rpcCall.mockResolvedValueOnce({
      jsonrpc_version: "2.0",
      contract: "komari.rpc.v2.4",
      methods: ["common:getRealtimeDelta"],
      capabilities: { "realtime.delta": "1" },
    });

    await expect(getKomariBackendProfile()).resolves.toMatchObject({
      kind: "fork-v2.4",
      methods: ["common:getRealtimeDelta"],
    });
    expect(rpcCall).toHaveBeenCalledTimes(1);
    expect(rpcCall).toHaveBeenCalledWith("rpc.discover", {});
  });

  it("identifies upstream by its public callable surface rather than a version string", async () => {
    rpcCall
      .mockRejectedValueOnce(new RpcResponseError("method not found", -32601))
      .mockResolvedValueOnce([...OFFICIAL_METHODS, "rpc.methods"]);

    await expect(getKomariBackendProfile()).resolves.toEqual({
      kind: "official-v1.4",
      methods: [...OFFICIAL_METHODS, "rpc.methods"],
    });
    expect(rpcCall).toHaveBeenNthCalledWith(1, "rpc.discover", {});
    expect(rpcCall).toHaveBeenNthCalledWith(2, "rpc.methods", { internal: true });
  });

  it("does not downgrade a non-method RPC failure into upstream mode", async () => {
    const failure = new RpcResponseError("permission denied", -32603);
    rpcCall.mockRejectedValueOnce(failure);

    await expect(getKomariBackendProfile()).rejects.toBe(failure);
    expect(rpcCall).toHaveBeenCalledTimes(1);
  });

  it("rejects an upstream server that lacks an API required by this theme", async () => {
    rpcCall
      .mockRejectedValueOnce(new RpcResponseError("method not found", -32601))
      .mockResolvedValueOnce(OFFICIAL_METHODS.slice(0, -1));

    await expect(getKomariBackendProfile()).rejects.toThrow(
      "public:getPingMetricStats",
    );
  });
});
