import { z } from "zod";
import { getRpc2Client, isRpcTransportError } from "@/services/rpc2Client";
import type { KomariBackendKind } from "@/services/backendProfile";
import type { MetricTimeRange } from "@/services/officialKomariAdapter";
import type { PingOverviewResult, RealtimeDelta } from "@/generated/rpcContract";
import {
  MeSchema,
  NodeInfoSchema,
  PublicConfigSchema,
  AdminClientSchema,
  LoadRecordSchema,
  PingRecordSchema,
  PingTaskSchema,
  PingBasicInfoSchema,
  type Me,
  type NodeInfo,
  type PublicConfig,
  type AdminClient,
  type LoadRecordsResponse,
  type PingRecordsResponse,
  type PingTask,
  type PingBasicInfo,
} from "@/types/komari";
import { fetchWithTimeout } from "@/utils/abort";

const ApiEnvelope = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    status: z.string().optional(),
    message: z.string().optional(),
    data: inner,
  });

const RpcRecordsSchema = z
  .object({
    count: z.number().default(0),
    records: z.unknown().optional(),
    tasks: z.unknown().optional(),
    basic_info: z.unknown().optional(),
  })
  .passthrough();

const LOAD_RECORDS_PER_HOUR = 12;
const PING_RECORDS_PER_HOUR = 240;
const MAX_RPC_RECORDS = 20_000;
const MAX_COMPARE_RECORDS_PER_NODE = 5_000;
const OVERVIEW_PING_MAX_COUNT = 4_000;
// 普通 HTTP GET(/api/nodes、/api/public、load/ping 兜底)自身没有传输超时,
// 在这里统一兜底,half-open socket 能快速失败而不是无限挂住调用方。
const DEFAULT_API_TIMEOUT_MS = 12_000;

interface RpcRecordsPayload {
  count?: number;
  records?: unknown;
  tasks?: unknown;
  basic_info?: unknown;
}

interface PingOverviewResponse {
  count: number;
  records: PingRecordsResponse["records"];
  tasks: PingTask[];
  basicInfo: PingBasicInfo[];
}

const PingOverviewResultSchema = z.object({
  from: z.union([z.string(), z.number()]),
  to: z.union([z.string(), z.number()]),
  tasks: z.array(z.object({
    id: z.number(),
    name: z.string().default(""),
    type: z.string().default("icmp"),
    interval: z.number().default(60),
  })),
  stats: z.record(z.string(), z.record(z.string(), z.object({
    name: z.string().default(""),
    total: z.number().default(0),
    lost: z.number().default(0),
    latest: z.number().default(-1),
    avg: z.number().default(0),
    tail: z.number().default(0),
    loss: z.number().default(0),
    min: z.number().default(0),
    max: z.number().default(0),
  }))),
  series: z.record(z.string(), z.record(z.string(), z.array(z.object({
    time: z.union([z.string(), z.number()]),
    value: z.number(),
    sample_count: z.number().default(0),
    loss_count: z.number().default(0),
    loss: z.number().default(0),
  })))).default({}),
});

const RealtimeDeltaSchema = z.object({
  sequence: z.number().int().nonnegative(),
  snapshot: z.boolean(),
  resync: z.boolean().optional(),
  reports: z.record(z.string(), z.unknown()).optional(),
  removed: z.array(z.string()).optional(),
  online: z.array(z.string()).optional(),
  offline: z.array(z.string()).optional(),
});

export type ComparisonLoadType =
  | "all"
  | "cpu"
  | "ram"
  | "swap"
  | "load"
  | "disk"
  | "network"
  | "process"
  | "connections";

export type ComparisonLoadRecords = Record<string, LoadRecordsResponse["records"]>;
export type ComparisonTimeRange = MetricTimeRange;

// The official metric adapter contains the larger protocol-normalization
// schemas. It is only useful after the backend probe selects upstream, so
// lazy-load it instead of charging every legacy/home initial render for it.
const getOfficialKomariAdapter = () => import("@/services/officialKomariAdapter");

// Detection is needed only when a data request starts. Keeping it out of the
// eager Home bundle preserves the original first-paint budget for both
// supported backends; the promise is still cached by backendProfile itself.
const getBackendProfile = () => import("@/services/backendProfile")
  .then(({ getKomariBackendProfile }) => getKomariBackendProfile());

const requireLegacyRpcCapability = (capability: "ping.overview") =>
  import("@/services/rpcCapabilities")
    .then(({ requireRpcCapability }) => requireRpcCapability(capability));

export interface RealtimeUpdate {
  delta: RealtimeDelta;
  /** The fork offers resumable long-poll deltas; upstream is a snapshot poll. */
  mode: "delta" | "poll";
  backend: KomariBackendKind;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly path: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

function normalizeRpcLatestStatus(
  payload: unknown,
): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const maybeRecords = (payload as Record<string, unknown>).records;
    const wrapped = z.record(z.string(), z.unknown()).safeParse(maybeRecords);
    if (wrapped.success) {
      return wrapped.data;
    }
  }

  const direct = z.record(z.string(), z.unknown()).safeParse(payload);
  if (direct.success) {
    return direct.data;
  }

  return {};
}

function getRecordsMaxCount(hours: number, recordsPerHour: number) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  return Math.min(
    MAX_RPC_RECORDS,
    Math.max(recordsPerHour, Math.ceil(safeHours * recordsPerHour)),
  );
}

export function getComparisonRecordsMaxCount(hours: number, recordsPerHour = LOAD_RECORDS_PER_HOUR) {
  return Math.min(
    MAX_COMPARE_RECORDS_PER_NODE,
    getRecordsMaxCount(hours, recordsPerHour),
  );
}

async function apiGet<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: { signal?: AbortSignal; timeout?: number },
): Promise<T> {
  const resp = await fetchWithTimeout(
    path,
    {
      credentials: "include",
      headers: { Accept: "application/json" },
    },
    options?.timeout ?? DEFAULT_API_TIMEOUT_MS,
    options?.signal,
  );
  if (!resp.ok) {
    throw new ApiRequestError(`Request ${path} failed: ${resp.status}`, resp.status, path);
  }
  const json = (await resp.json()) as unknown;
  const envelopeResult = ApiEnvelope(schema).safeParse(json);
  if (envelopeResult.success) return envelopeResult.data.data as T;
  const rawResult = schema.safeParse(json);
  if (rawResult.success) return rawResult.data;
  // 两种解析错误都抛出来:enveloped 接口看 envelope 错误,裸 array/object 接口看 raw
  // 错误,而这里无法判断接口本该返回哪种结构。
  throw new Error(
    `Schema mismatch on ${path}: envelope=${
      envelopeResult.error.issues[0]?.message ?? ""
    }; raw=${rawResult.error.issues[0]?.message ?? ""}`,
  );
}

async function rpcCall<T>(
  method: string,
  params: Record<string, unknown>,
  schema: z.ZodType<T>,
  options?: { timeout?: number; signal?: AbortSignal; httpOnly?: boolean },
): Promise<T> {
  const payload = options?.httpOnly
    ? await getRpc2Client().callHttp(method, params, options)
    : await getRpc2Client().call(method, params, options);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Schema mismatch on rpc:${method}: ${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  return parsed.data;
}

// 丢掉单条解析失败的记录,而不是让整个数组抛错。否则一条坏记录会让 RPC normalize
// 抛错,调用方捕获后兜底到完整 HTTP 请求 —— 一条坏数据就变成每次轮询都 RPC + HTTP
// 双重拉取。
function parseArrayLenient<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S>[] {
  if (!Array.isArray(value)) return [];
  const out: z.infer<S>[] = [];
  for (const item of value) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function extractRpcRecords(payload: RpcRecordsPayload, key?: string): unknown[] {
  if (Array.isArray(payload.records)) return payload.records;
  if (!payload.records || typeof payload.records !== "object") return [];

  const recordsByKey = payload.records as Record<string, unknown>;
  if (key && Array.isArray(recordsByKey[key])) {
    return recordsByKey[key];
  }

  return Object.values(recordsByKey).flatMap((value) =>
    Array.isArray(value) ? value : [],
  );
}

function normalizeRpcLoadRecords(
  uuid: string,
  payload: RpcRecordsPayload,
): LoadRecordsResponse {
  const records = parseArrayLenient(LoadRecordSchema, extractRpcRecords(payload, uuid));
  return {
    count: payload.count || records.length,
    records,
  };
}

function derivePingTasks(records: PingRecordsResponse["records"]): PingTask[] {
  return Array.from(new Set(records.map((record) => record.task_id)))
    .sort((a, b) => a - b)
    .map((id) => ({
      id,
      interval: 60,
      name: `任务 #${id}`,
      loss: 0,
      clients: [],
      type: "icmp",
      target: "",
      weight: id,
    }));
}

function normalizeRpcPingRecords(
  uuid: string,
  payload: RpcRecordsPayload,
): PingRecordsResponse {
  const records = parseArrayLenient(PingRecordSchema, extractRpcRecords(payload, uuid));
  const parsedTasks = z.array(PingTaskSchema).safeParse(payload.tasks);
  const tasks = parsedTasks.success ? parsedTasks.data : derivePingTasks(records);
  return {
    count: payload.count || records.length,
    records,
    tasks,
  };
}

function normalizeRpcPingOverview(
  payload: RpcRecordsPayload,
): PingOverviewResponse {
  const records = parseArrayLenient(PingRecordSchema, extractRpcRecords(payload));
  const parsedTasks = z.array(PingTaskSchema).safeParse(payload.tasks);
  const basicInfo = z.array(PingBasicInfoSchema).safeParse(payload.basic_info);
  return {
    count: payload.count || records.length,
    records,
    tasks: parsedTasks.success ? parsedTasks.data : derivePingTasks(records),
    basicInfo: basicInfo.success ? basicInfo.data : [],
  };
}

export async function getMe(): Promise<Me> {
  // 必须 cast:zod `.passthrough()` schema 经 apiGet 推断出的是 input 类型(默认字段
  // 变可选),这里要重新收窄回来。
  return (await apiGet("/api/me", MeSchema)) as Me;
}

export async function getPublic(): Promise<PublicConfig> {
  return (await apiGet("/api/public", PublicConfigSchema)) as PublicConfig;
}

export async function getNodesLatestStatus(
  uuids?: string[],
  options?: { timeout?: number; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const payload = await rpcCall(
    "common:getNodesLatestStatus",
    uuids && uuids.length > 0 ? { uuids } : {},
    z.unknown(),
    options,
  );
  return normalizeRpcLatestStatus(payload);
}

export async function getRealtimeDelta(
  since: number,
  uuids: string[],
  options?: { waitMs?: number; timeout?: number; signal?: AbortSignal },
): Promise<RealtimeDelta> {
  return (await getRealtimeUpdate(since, uuids, options)).delta;
}

/**
 * Return one normalized state update for either supported server family.
 *
 * Upstream does not expose the fork's resumable `common:getRealtimeDelta`.
 * Its latest-status map contains an explicit `online` flag and a retained
 * latest report for offline nodes, so a synthetic full snapshot preserves the
 * existing store merge semantics without pretending that a delta exists.
 */
export async function getRealtimeUpdate(
  since: number,
  uuids: string[],
  options?: { waitMs?: number; timeout?: number; signal?: AbortSignal },
): Promise<RealtimeUpdate> {
  const backend = await getBackendProfile();
  const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)));
  if (backend.kind === "official-v1.4") {
    const reports = await getNodesLatestStatus(uniqueUuids, {
      timeout: options?.timeout,
      signal: options?.signal,
    });
    return {
      backend: backend.kind,
      mode: "poll",
      delta: {
        sequence: Math.max(1, Math.trunc(since) + 1),
        snapshot: true,
        reports,
      },
    };
  }

  const delta = await rpcCall(
    "common:getRealtimeDelta",
    {
      since: Math.max(0, Math.trunc(since)),
	  // 空集合表示服务端可见的全部节点。超过单请求 UUID 上限时使用它，
	  // 从而让 300/1000 节点面板也只维持一条 delta 流。
      uuids: uniqueUuids.length <= 256 ? uniqueUuids : [],
      wait_ms: Math.min(25_000, Math.max(0, Math.trunc(options?.waitMs ?? 25_000))),
    },
    RealtimeDeltaSchema,
    { timeout: options?.timeout ?? 30_000, signal: options?.signal, httpOnly: true },
  );
  return { backend: backend.kind, mode: "delta", delta };
}

export async function getNodes(): Promise<NodeInfo[]> {
  return (await apiGet("/api/nodes", z.array(NodeInfoSchema))) as NodeInfo[];
}

export async function getAdminClients(): Promise<AdminClient[]> {
  return (await apiGet("/api/admin/client/list", z.array(AdminClientSchema))) as AdminClient[];
}

export async function getLoadRecords(
  uuid: string,
  hours = 6,
  /**
   * Upstream metric points intentionally omit capacity denominators.  The
   * current node metadata keeps the instance charts' percentage axes useful
   * without adding a second per-chart HTTP request.
   */
  node?: NodeInfo,
): Promise<LoadRecordsResponse> {
  let backend: Awaited<ReturnType<typeof getBackendProfile>> | undefined;
  try {
    backend = await getBackendProfile();
  } catch (error) {
    // During an RPC transport outage the legacy HTTP endpoint remains a safe
    // read-only fallback. Do not swallow protocol/permission failures: they
    // need to remain actionable rather than silently changing data sources.
    if (!isRpcTransportError(error)) throw error;
  }
  if (backend?.kind === "official-v1.4") {
    const { getOfficialComparisonLoadRecords } = await getOfficialKomariAdapter();
    const records = await getOfficialComparisonLoadRecords({
      uuids: [uuid],
      hours,
      loadType: "all",
      nodes: node ? [node] : undefined,
      maxPoints: getRecordsMaxCount(hours, LOAD_RECORDS_PER_HOUR),
    });
    const normalized = records[uuid] ?? [];
    return { count: normalized.length, records: normalized };
  }
  if (!backend) return await getLegacyLoadRecords(uuid, hours);
  try {
    const maxCount = getRecordsMaxCount(hours, LOAD_RECORDS_PER_HOUR);
    const payload = await rpcCall(
      "common:getRecords",
      {
        uuid,
        hours,
        type: "load",
        maxCount,
      },
      RpcRecordsSchema,
    );
    return normalizeRpcLoadRecords(uuid, payload);
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
    return await getLegacyLoadRecords(uuid, hours);
  }
}

async function getLegacyLoadRecords(uuid: string, hours: number): Promise<LoadRecordsResponse> {
  return (await apiGet(
    `/api/records/load?${new URLSearchParams({ uuid, hours: String(hours) })}`,
    z.object({
      count: z.number().default(0),
      records: z.array(LoadRecordSchema).default([]),
    }),
  )) as LoadRecordsResponse;
}

export async function getComparisonLoadRecords({
  uuids,
  hours = 6,
  loadType,
  nodes,
  range,
}: {
  uuids: string[];
  hours?: number;
  loadType: ComparisonLoadType;
  /** Current node totals keep percentage charts meaningful for upstream metrics. */
  nodes?: NodeInfo[];
  range?: ComparisonTimeRange;
}): Promise<ComparisonLoadRecords> {
  const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)));
  if (uniqueUuids.length === 0) return {};

  const perNodeMaxCount = getComparisonRecordsMaxCount(hours, LOAD_RECORDS_PER_HOUR);
  const backend = await getBackendProfile();
  if (backend.kind === "official-v1.4") {
    const { getOfficialComparisonLoadRecords } = await getOfficialKomariAdapter();
    return await getOfficialComparisonLoadRecords({
      uuids: uniqueUuids,
      hours,
      loadType,
      nodes,
      range,
      maxPoints: perNodeMaxCount,
    });
  }
  try {
    const payload = await rpcCall(
      "common:getRecords",
      {
        uuids: uniqueUuids,
        hours,
        type: "load",
        load_type: loadType,
        ...(range ? {
          start: range.start,
          end: range.end,
        } : {}),
        maxCount: Math.min(MAX_RPC_RECORDS, perNodeMaxCount * uniqueUuids.length),
      },
      RpcRecordsSchema,
    );
    return Object.fromEntries(uniqueUuids.map((uuid) => [
      uuid,
      normalizeRpcLoadRecords(uuid, payload).records,
    ]));
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
    return Object.fromEntries(await Promise.all(uniqueUuids.map(async (uuid) => [
      uuid,
      (await getLegacyLoadRecords(uuid, hours)).records,
    ] as const)));
  }
}

export async function getPingRecords(
  uuid: string,
  hours = 6,
  range?: ComparisonTimeRange,
): Promise<PingRecordsResponse> {
  if (range) return getComparisonPingRecords({ uuids: [uuid], hours, range });
  let backend: Awaited<ReturnType<typeof getBackendProfile>> | undefined;
  try {
    backend = await getBackendProfile();
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
  }
  if (backend?.kind === "official-v1.4") {
    const { getOfficialComparisonPingRecords } = await getOfficialKomariAdapter();
    return await getOfficialComparisonPingRecords({
      uuids: [uuid],
      hours,
      maxPoints: getRecordsMaxCount(hours, PING_RECORDS_PER_HOUR),
    });
  }
  if (!backend) return await getLegacyPingRecords(uuid, hours);
  try {
    const maxCount = getRecordsMaxCount(hours, PING_RECORDS_PER_HOUR);
    const payload = await rpcCall(
      "common:getRecords",
      {
        uuid,
        hours,
        type: "ping",
        maxCount,
      },
      RpcRecordsSchema,
    );
    return normalizeRpcPingRecords(uuid, payload);
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
    return await getLegacyPingRecords(uuid, hours);
  }
}

async function getLegacyPingRecords(uuid: string, hours: number): Promise<PingRecordsResponse> {
  return (await apiGet(
    `/api/records/ping?${new URLSearchParams({ uuid, hours: String(hours) })}`,
    z.object({
      count: z.number().default(0),
      records: z.array(PingRecordSchema).default([]),
      tasks: z.array(PingTaskSchema).default([]),
    }),
  )) as PingRecordsResponse;
}

export async function getComparisonPingRecords({
  uuids,
  hours = 6,
  range,
}: {
  uuids: string[];
  hours?: number;
  range?: ComparisonTimeRange;
}): Promise<PingRecordsResponse> {
  const uniqueUuids = Array.from(new Set(uuids.filter(Boolean)));
  if (uniqueUuids.length === 0) {
    return { count: 0, records: [], tasks: [] };
  }

  const perNodeMaxCount = getComparisonRecordsMaxCount(hours, PING_RECORDS_PER_HOUR);
  const backend = await getBackendProfile();
  if (backend.kind === "official-v1.4") {
    const { getOfficialComparisonPingRecords } = await getOfficialKomariAdapter();
    return await getOfficialComparisonPingRecords({
      uuids: uniqueUuids,
      hours,
      range,
      maxPoints: perNodeMaxCount,
    });
  }
  let responses: PingRecordsResponse[];
  try {
    const payload = await rpcCall(
      "common:getRecords",
      {
        uuids: uniqueUuids,
        hours,
        type: "ping",
        ...(range ? {
          start: range.start,
          end: range.end,
        } : {}),
        maxCount: Math.min(MAX_RPC_RECORDS, perNodeMaxCount * uniqueUuids.length),
      },
      RpcRecordsSchema,
    );
    responses = uniqueUuids.map((uuid) => normalizeRpcPingRecords(uuid, payload));
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
    responses = await Promise.all(uniqueUuids.map(async (uuid) => {
      const response = await getLegacyPingRecords(uuid, hours);
      return {
        ...response,
        records: response.records.map((record) => ({ ...record, client: record.client || uuid })),
      };
    }));
  }
  const taskById = new Map<number, PingTask>();
  const records = responses.flatMap((response) => response.records);
  for (const response of responses) {
    for (const task of response.tasks) {
      if (!taskById.has(task.id)) taskById.set(task.id, task);
    }
  }

  records.sort((a, b) => {
    const at = typeof a.time === "number" ? a.time : Date.parse(a.time);
    const bt = typeof b.time === "number" ? b.time : Date.parse(b.time);
    return at - bt;
  });

  return {
    count: records.length,
    records,
    tasks: Array.from(taskById.values()).sort((a, b) => a.id - b.id),
  };
}

export async function getAdminPingTasks(): Promise<PingTask[]> {
  return (await apiGet("/api/admin/ping", z.array(PingTaskSchema))) as PingTask[];
}

export async function saveThemeSettings(
  theme: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const resp = await fetchWithTimeout(
    `/api/admin/theme/settings?theme=${encodeURIComponent(theme)}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(settings),
    },
    DEFAULT_API_TIMEOUT_MS,
  );

  if (!resp.ok) {
    let message = `Request /api/admin/theme/settings failed: ${resp.status}`;
    try {
      const json = (await resp.json()) as { message?: string };
      if (json?.message) {
        message = json.message;
      }
    } catch {
      // body 不是 JSON 时保留兜底错误信息。
    }
    throw new ApiRequestError(message, resp.status, "/api/admin/theme/settings");
  }
}

export async function getPingOverview(
  hours = 1,
  taskId?: number,
  options?: { signal?: AbortSignal },
): Promise<PingOverviewResponse> {
  let backend: Awaited<ReturnType<typeof getBackendProfile>> | undefined;
  try {
    backend = await getBackendProfile();
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
  }
  if (backend?.kind === "official-v1.4") {
    const { getOfficialComparisonPingRecords } = await getOfficialKomariAdapter();
    // This compatibility helper predates the dashboard's batched overview
    // endpoint.  Upstream does not have its fork-only `common:getRecords`
    // shape, so use the same public metric adapter as the other chart paths.
    // The helper is rarely used, but keeping it functional prevents an
    // accidental feature regression for integrations importing this API.
    const nodes = await getNodes();
    const response = await getOfficialComparisonPingRecords({
      uuids: nodes.map((node) => node.uuid),
      hours,
      maxPoints: getRecordsMaxCount(hours, PING_RECORDS_PER_HOUR),
      options,
    });
    const records = taskId == null
      ? response.records
      : response.records.filter((record) => record.task_id === taskId);
    const tasks = taskId == null
      ? response.tasks
      : response.tasks.filter((task) => task.id === taskId);
    return {
      count: records.length,
      records,
      tasks,
      basicInfo: [],
    };
  }
  try {
    const payload = await rpcCall(
      "common:getRecords",
      {
        hours,
        type: "ping",
        ...(taskId != null ? { task_id: taskId } : {}),
        maxCount: OVERVIEW_PING_MAX_COUNT,
      },
      RpcRecordsSchema,
      { signal: options?.signal },
    );
    return normalizeRpcPingOverview(payload);
  } catch (error) {
    if (!isRpcTransportError(error)) throw error;
    if (taskId == null) {
      throw new Error("Ping overview fallback requires a concrete task_id");
    }
    if (options?.signal?.aborted) {
      throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
    }

    const data = await apiGet(
      `/api/records/ping?${new URLSearchParams({ task_id: String(taskId), hours: String(hours) })}`,
      z.object({
        count: z.number().default(0),
        records: z.array(PingRecordSchema).default([]),
        tasks: z.array(PingTaskSchema).default([]),
        basic_info: z.array(PingBasicInfoSchema).default([]),
      }),
      { signal: options?.signal },
    );
    return {
      count: data.count,
      records: data.records,
      tasks: data.tasks,
      basicInfo: data.basic_info,
    } as PingOverviewResponse;
  }
}

export async function getPingOverviewForNodes(
  uuids: string[],
  options?: { signal?: AbortSignal },
): Promise<PingOverviewResult> {
  const backend = await getBackendProfile();
  if (backend.kind === "official-v1.4") {
    const { getOfficialPingOverviewForNodes } = await getOfficialKomariAdapter();
    return await getOfficialPingOverviewForNodes(uuids, options);
  }
  await requireLegacyRpcCapability("ping.overview");
  return await rpcCall(
    "common:getPingOverview",
    { uuids: Array.from(new Set(uuids.filter(Boolean))) },
    PingOverviewResultSchema,
    { signal: options?.signal },
  ) as PingOverviewResult;
}
