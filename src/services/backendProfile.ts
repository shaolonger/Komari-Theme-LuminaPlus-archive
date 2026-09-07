import { z } from "zod";
import { RPC_CONTRACT, type RpcDiscovery } from "@/generated/rpcContract";
import { getRpc2Client, RpcResponseError } from "@/services/rpc2Client";

/**
 * A backend is identified by callable behaviour, never by its display version.
 *
 * The maintained fork and upstream can both publish a similarly named version,
 * while exposing different JSON-RPC contracts.  Keep that distinction at the
 * edge of the data layer so page components only consume normalized data.
 */
export type KomariBackendKind = "fork-v2.4" | "official-v1.4";

export interface KomariBackendProfile {
  kind: KomariBackendKind;
  methods: readonly string[];
  discovery?: RpcDiscovery;
}

const DiscoverySchema = z.object({
  jsonrpc_version: z.literal("2.0"),
  contract: z.string(),
  methods: z.array(z.string()),
  capabilities: z.record(z.string(), z.string()),
});

const MethodsSchema = z.array(z.string());

const OFFICIAL_REQUIRED_METHODS = [
  "common:getNodesLatestStatus",
  "public:getPublicPingTasks",
  "public:queryMetrics",
  "public:getPingMetricStats",
] as const;

let profilePromise: Promise<KomariBackendProfile> | null = null;

function isMethodMissing(error: unknown) {
  return error instanceof RpcResponseError && (
    error.code === -32601 || /method(?:\s+is)?\s+not\s+found/i.test(error.message)
  );
}

async function discoverBackendProfile(): Promise<KomariBackendProfile> {
  try {
    const payload = await getRpc2Client().call("rpc.discover", {});
    const discovery = DiscoverySchema.safeParse(payload);
    if (!discovery.success) {
      throw new Error("Komari rpc.discover returned an unsupported response shape");
    }
    if (discovery.data.contract !== RPC_CONTRACT) {
      throw new Error(`Unsupported Komari RPC contract: ${discovery.data.contract}`);
    }
    return {
      kind: "fork-v2.4",
      methods: discovery.data.methods,
      discovery: discovery.data as RpcDiscovery,
    };
  } catch (error) {
    if (!isMethodMissing(error)) throw error;
  }

  // Upstream 1.4.x deliberately exposes rpc.methods instead of the fork's
  // rpc.discover contract. Asking for internal methods avoids relying on a
  // version string and lets a later upstream release add methods freely.
  const methods = MethodsSchema.parse(await getRpc2Client().call("rpc.methods", { internal: true }));
  const known = new Set(methods);
  const missing = OFFICIAL_REQUIRED_METHODS.filter((method) => !known.has(method));
  if (missing.length > 0) {
    throw new Error(`Unsupported official Komari RPC surface; missing ${missing.join(", ")}`);
  }
  return { kind: "official-v1.4", methods };
}

export function getKomariBackendProfile(): Promise<KomariBackendProfile> {
  if (!profilePromise) {
    profilePromise = discoverBackendProfile().catch((error) => {
      profilePromise = null;
      throw error;
    });
  }
  return profilePromise;
}

export async function isOfficialKomariBackend() {
  return (await getKomariBackendProfile()).kind === "official-v1.4";
}

export function resetKomariBackendProfileForTests() {
  profilePromise = null;
}
