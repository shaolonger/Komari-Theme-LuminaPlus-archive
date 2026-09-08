import { z } from "zod";
import type { PingOverviewResult, PingOverviewStat } from "@/generated/rpcContract";
import { getRpc2Client } from "@/services/rpc2Client";
import type { ComparisonLoadType } from "@/services/api";
import type { LoadRecord, NodeInfo, PingRecord, PingRecordsResponse, PingTask } from "@/types/komari";

/**
 * Normalizers for the upstream 1.4.x metric API.
 *
 * Upstream intentionally replaced the fork's multi-node `common:getRecords`
 * extension with a metric-series API. Keep that protocol knowledge here; the
 * rest of the application continues to consume the established card and
 * comparison models.
 */

export interface MetricTimeRange {
  start?: Date | number | string | null;
  end?: Date | number | string | null;
}

interface OfficialCallOptions {
  timeout?: number;
  signal?: AbortSignal;
}

const MetricPointSchema = z.object({
  time: z.union([z.string(), z.number()]),
  value: z.number().nullable().optional(),
  count: z.number().finite().nonnegative().default(0),
  tags: z.record(z.string(), z.string()).default({}),
}).passthrough();

const MetricSeriesSchema = z.object({
  metric_key: z.string(),
  entity_id: z.string().default(""),
  tags: z.record(z.string(), z.string()).default({}),
  points: z.array(MetricPointSchema).default([]),
}).passthrough();

const MetricQueryResponseSchema = z.object({
  start: z.union([z.string(), z.number()]).optional(),
  end: z.union([z.string(), z.number()]).optional(),
  series: z.array(MetricSeriesSchema).default([]),
  count: z.number().default(0),
}).passthrough();

const OfficialPingTaskSchema = z.object({
  id: z.number(),
  weight: z.number().default(0),
  name: z.string().default(""),
  clients: z.array(z.string()).default([]),
  default_on: z.boolean().default(false),
  type: z.string().default("icmp"),
  interval: z.number().default(60),
}).passthrough();

const OfficialPingStatsResponseSchema = z.object({
  start: z.union([z.string(), z.number()]).optional(),
  end: z.union([z.string(), z.number()]).optional(),
  stats: z.array(z.object({
    entity_id: z.string(),
    task_id: z.union([z.string(), z.number()]),
    name: z.string().default(""),
    type: z.string().default("icmp"),
    interval: z.number().default(60),
    total: z.number().finite().nonnegative().default(0),
    valid: z.number().finite().nonnegative().default(0),
    loss: z.number().finite().default(0),
    loss_approximate: z.boolean().default(false),
    min: z.number().finite().nullable().optional(),
    max: z.number().finite().nullable().optional(),
    avg: z.number().finite().nullable().optional(),
    latest: z.number().finite().nullable().optional(),
    p99_p50_ratio: z.number().finite().default(0),
  }).passthrough()).default([]),
  count: z.number().default(0),
}).passthrough();

type OfficialMetricPoint = z.output<typeof MetricPointSchema>;
type OfficialMetricSeries = z.output<typeof MetricSeriesSchema>;

const OFFICIAL_LOAD_METRICS = {
  cpu: "cpu.usage",
  ram: "memory.used",
  swap: "swap.used",
  load: "load.average",
  disk: "disk.used",
  netIn: "net.in.rate",
  netOut: "net.out.rate",
  netTotalUp: "net.total.up",
  netTotalDown: "net.total.down",
  process: "process.count",
  connections: "connections.tcp",
  connectionsUdp: "connections.udp",
} as const;

const OFFICIAL_PING_LATENCY_METRIC = "ping.latency_ms";
const OFFICIAL_PING_LOSS_METRIC = "ping.loss";

const ALL_OFFICIAL_LOAD_METRICS = Object.values(OFFICIAL_LOAD_METRICS);

// `net.total.*` is a counter snapshot, not an interval measurement.  The
// upstream compatibility reader deliberately uses `last` for these two
// metrics, so do the same when reconstructing the theme's historical records.
const OFFICIAL_LOAD_AGGREGATION_BY_METRIC: Readonly<Record<string, string>> = {
  [OFFICIAL_LOAD_METRICS.netTotalUp]: "last",
  [OFFICIAL_LOAD_METRICS.netTotalDown]: "last",
};

// Ping latency uses an arithmetic mean below so a rollup keeps a useful trend.
// A failed probe is stored upstream as latency `-1`; paired `ping.loss` values
// let `resolvePingBucket` remove that sentinel from the displayed mean.
const OFFICIAL_PING_AGGREGATION_BY_METRIC: Readonly<Record<string, string>> = {
  [OFFICIAL_PING_LATENCY_METRIC]: "avg",
  [OFFICIAL_PING_LOSS_METRIC]: "avg",
};

function uniqueUuids(uuids: string[]) {
  return Array.from(new Set(uuids.filter(Boolean)));
}

async function callOfficial<TSchema extends z.ZodTypeAny>(
  method: string,
  params: Record<string, unknown>,
  schema: TSchema,
  options?: OfficialCallOptions,
): Promise<z.output<TSchema>> {
  const payload = await getRpc2Client().call(method, params, options);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Schema mismatch on official rpc:${method}: ${parsed.error.issues[0]?.message ?? ""}`,
    );
  }
  return parsed.data;
}

function toDate(value: Date | number | string | null | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(value.getTime()) : null;
  }
  if (typeof value === "number") {
    const milliseconds = value > 1_000_000_000_000 ? value : value * 1_000;
    const date = new Date(milliseconds);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  return null;
}

export function resolveOfficialMetricWindow(
  hours: number,
  range?: MetricTimeRange,
  now = new Date(),
) {
  const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 1;
  const requestedEnd = toDate(range?.end) ?? new Date(now.getTime());
  const requestedStart = toDate(range?.start) ?? new Date(
    requestedEnd.getTime() - safeHours * 60 * 60 * 1_000,
  );
  if (requestedEnd.getTime() > requestedStart.getTime()) {
    return { start: requestedStart, end: requestedEnd };
  }
  return {
    start: new Date(requestedEnd.getTime() - safeHours * 60 * 60 * 1_000),
    end: requestedEnd,
  };
}

function metricTimeKey(value: string | number) {
  const date = toDate(value);
  return date?.getTime() ?? 0;
}

function toMetricCount(value: number | null | undefined) {
  if (!Number.isFinite(value) || !value || value <= 0) return 0;
  return Math.max(1, Math.round(value));
}

function clampRatio(value: number | null | undefined) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value as number));
}

function getTaskId(series: OfficialMetricSeries, point: OfficialMetricPoint) {
  const raw = point.tags.task_id || series.tags.task_id;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function toPingTask(task: z.infer<typeof OfficialPingTaskSchema>): PingTask {
  return {
    id: task.id,
    interval: task.interval,
    name: task.name,
    loss: 0,
    clients: task.clients,
    type: task.type,
    // Upstream intentionally does not expose task targets to public callers.
    target: "",
    weight: task.weight,
  };
}

async function queryOfficialMetrics({
  metricKeys,
  uuids,
  window,
  maxPoints,
  fillEmpty,
  aggregationByMetric,
  options,
}: {
  metricKeys: string[];
  uuids: string[];
  window: { start: Date; end: Date };
  maxPoints: number;
  fillEmpty: boolean;
  aggregationByMetric?: Readonly<Record<string, string>>;
  options?: OfficialCallOptions;
}) {
  const scopedAggregationByMetric = Object.fromEntries(
    metricKeys.flatMap((metricKey) => {
      const aggregation = aggregationByMetric?.[metricKey];
      return aggregation ? [[metricKey, aggregation]] : [];
    }),
  );
  return await callOfficial(
    "public:queryMetrics",
    {
      metric_keys: metricKeys,
      entity_ids: uuids,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      max_points: Math.max(1, Math.trunc(maxPoints)),
      aggregation: "avg",
      fill_empty: fillEmpty,
      ...(Object.keys(scopedAggregationByMetric).length > 0
        ? { aggregation_by_metric: scopedAggregationByMetric }
        : {}),
    },
    MetricQueryResponseSchema,
    options,
  );
}

function requestedLoadMetricKeys(loadType: ComparisonLoadType) {
  switch (loadType) {
    case "cpu":
      return [OFFICIAL_LOAD_METRICS.cpu];
    case "ram":
      return [OFFICIAL_LOAD_METRICS.ram];
    case "swap":
      return [OFFICIAL_LOAD_METRICS.swap];
    case "load":
      return [OFFICIAL_LOAD_METRICS.load];
    case "disk":
      return [OFFICIAL_LOAD_METRICS.disk];
    case "network":
      return [
        OFFICIAL_LOAD_METRICS.netIn,
        OFFICIAL_LOAD_METRICS.netOut,
        OFFICIAL_LOAD_METRICS.netTotalUp,
        OFFICIAL_LOAD_METRICS.netTotalDown,
      ];
    case "process":
      return [OFFICIAL_LOAD_METRICS.process];
    case "connections":
      return [OFFICIAL_LOAD_METRICS.connections, OFFICIAL_LOAD_METRICS.connectionsUdp];
    case "all":
    default:
      return ALL_OFFICIAL_LOAD_METRICS;
  }
}

function emptyLoadRecord(
  uuid: string,
  time: string | number,
  node?: NodeInfo,
): LoadRecord {
  return {
    cpu: 0,
    gpu: 0,
    ram: 0,
    ram_total: node?.mem_total ?? 0,
    swap: 0,
    swap_total: node?.swap_total ?? 0,
    load: 0,
    temp: 0,
    disk: 0,
    disk_total: node?.disk_total ?? 0,
    net_in: 0,
    net_out: 0,
    net_total_up: 0,
    net_total_down: 0,
    process: 0,
    connections: 0,
    connections_udp: 0,
    time,
    client: uuid,
  };
}

function applyLoadMetric(record: LoadRecord, metricKey: string, value: number) {
  switch (metricKey) {
    case OFFICIAL_LOAD_METRICS.cpu:
      record.cpu = value;
      break;
    case OFFICIAL_LOAD_METRICS.ram:
      record.ram = value;
      break;
    case OFFICIAL_LOAD_METRICS.swap:
      record.swap = value;
      break;
    case OFFICIAL_LOAD_METRICS.load:
      record.load = value;
      break;
    case OFFICIAL_LOAD_METRICS.disk:
      record.disk = value;
      break;
    case OFFICIAL_LOAD_METRICS.netIn:
      record.net_in = value;
      break;
    case OFFICIAL_LOAD_METRICS.netOut:
      record.net_out = value;
      break;
    case OFFICIAL_LOAD_METRICS.netTotalUp:
      record.net_total_up = value;
      break;
    case OFFICIAL_LOAD_METRICS.netTotalDown:
      record.net_total_down = value;
      break;
    case OFFICIAL_LOAD_METRICS.process:
      record.process = value;
      break;
    case OFFICIAL_LOAD_METRICS.connections:
      record.connections = value;
      break;
    case OFFICIAL_LOAD_METRICS.connectionsUdp:
      record.connections_udp = value;
      break;
    default:
      break;
  }
}

export async function getOfficialComparisonLoadRecords({
  uuids,
  hours,
  loadType,
  nodes,
  range,
  maxPoints,
  options,
}: {
  uuids: string[];
  hours: number;
  loadType: ComparisonLoadType;
  nodes?: NodeInfo[];
  range?: MetricTimeRange;
  maxPoints: number;
  options?: OfficialCallOptions;
}): Promise<Record<string, LoadRecord[]>> {
  const entityIds = uniqueUuids(uuids);
  if (entityIds.length === 0) return {};
  const nodeByUuid = new Map((nodes ?? []).map((node) => [node.uuid, node]));
  const response = await queryOfficialMetrics({
    metricKeys: requestedLoadMetricKeys(loadType),
    uuids: entityIds,
    window: resolveOfficialMetricWindow(hours, range),
    maxPoints,
    fillEmpty: false,
    aggregationByMetric: OFFICIAL_LOAD_AGGREGATION_BY_METRIC,
    options,
  });
  const known = new Set(entityIds);
  const recordsByUuid = new Map<string, Map<number, LoadRecord>>();

  for (const series of response.series) {
    if (!known.has(series.entity_id)) continue;
    for (const point of series.points) {
      if (point.value == null || !Number.isFinite(point.value)) continue;
      const time = metricTimeKey(point.time);
      if (time <= 0) continue;
      let recordsAtTime = recordsByUuid.get(series.entity_id);
      if (!recordsAtTime) {
        recordsAtTime = new Map();
        recordsByUuid.set(series.entity_id, recordsAtTime);
      }
      let record = recordsAtTime.get(time);
      if (!record) {
        record = emptyLoadRecord(series.entity_id, point.time, nodeByUuid.get(series.entity_id));
        recordsAtTime.set(time, record);
      }
      applyLoadMetric(record, series.metric_key, point.value);
    }
  }

  return Object.fromEntries(entityIds.map((uuid) => {
    const records = Array.from(recordsByUuid.get(uuid)?.values() ?? [])
      .sort((left, right) => metricTimeKey(left.time) - metricTimeKey(right.time));
    return [uuid, records];
  }));
}

interface PingBucket {
  time: string | number;
  latency?: number;
  latencyCount: number;
  loss?: number;
  lossSampleCount: number;
}

function collectPingBuckets(seriesList: OfficialMetricSeries[]) {
  const byNodeTask = new Map<string, Map<number, Map<number, PingBucket>>>();
  for (const series of seriesList) {
    if (
      series.metric_key !== OFFICIAL_PING_LATENCY_METRIC &&
      series.metric_key !== OFFICIAL_PING_LOSS_METRIC
    ) {
      continue;
    }
    for (const point of series.points) {
      const taskId = getTaskId(series, point);
      const time = metricTimeKey(point.time);
      if (!series.entity_id || taskId == null || time <= 0) continue;
      let byTask = byNodeTask.get(series.entity_id);
      if (!byTask) {
        byTask = new Map();
        byNodeTask.set(series.entity_id, byTask);
      }
      let byTime = byTask.get(taskId);
      if (!byTime) {
        byTime = new Map();
        byTask.set(taskId, byTime);
      }
      let bucket = byTime.get(time);
      if (!bucket) {
        bucket = { time: point.time, latencyCount: 0, lossSampleCount: 0 };
        byTime.set(time, bucket);
      }
      const count = toMetricCount(point.count);
      if (series.metric_key === OFFICIAL_PING_LATENCY_METRIC) {
        bucket.latencyCount = Math.max(bucket.latencyCount, count);
        if (point.value != null && Number.isFinite(point.value)) {
          bucket.latency = point.value;
        }
      } else {
        bucket.lossSampleCount = Math.max(bucket.lossSampleCount, count);
        if (point.value != null && Number.isFinite(point.value)) {
          bucket.loss = clampRatio(point.value) ?? undefined;
        }
      }
    }
  }
  return byNodeTask;
}

interface ResolvedPingBucket {
  sampleCount: number;
  lossCount: number;
  lossRate: number;
  validCount: number;
  latency: number;
}

/**
 * `ping.latency_ms` stores a failed probe as -1, while `ping.loss` stores the
 * matching 0/1 indicator.  A rollup's latency average therefore includes the
 * sentinel.  Given the shared count and loss count we can recover the mean of
 * successful probes exactly:
 *
 *   validAverage = (allSampleAverage * count + lost) / (count - lost)
 *
 * This is valid for raw one-sample points too, and avoids presenting a
 * partially lost `[100, -1]` bucket as a fictitious 49.5 ms latency.
 */
function resolvePingBucket(bucket: PingBucket): ResolvedPingBucket | null {
  const sampleCount = Math.max(bucket.latencyCount, bucket.lossSampleCount);
  if (sampleCount <= 0) return null;

  const lossRate = bucket.loss ?? (bucket.latency != null && bucket.latency <= 0 ? 1 : 0);
  const lossCount = Math.max(0, Math.min(sampleCount, Math.round(lossRate * sampleCount)));
  const validCount = Math.max(0, sampleCount - lossCount);
  let latency = -1;

  if (validCount > 0 && bucket.latency != null && Number.isFinite(bucket.latency)) {
    const successfulAverage = (bucket.latency * sampleCount + lossCount) / validCount;
    if (Number.isFinite(successfulAverage) && successfulAverage > 0) {
      latency = successfulAverage;
    }
  }

  return { sampleCount, lossCount, lossRate, validCount, latency };
}

function bucketToPingRecord(uuid: string, taskId: number, bucket: PingBucket): PingRecord | null {
  const resolved = resolvePingBucket(bucket);
  if (!resolved) return null;
  return {
    client: uuid,
    task_id: taskId,
    time: bucket.time,
    value: resolved.latency,
    sample_count: resolved.sampleCount,
    loss_count: resolved.lossCount,
    loss_rate: resolved.lossRate,
  };
}

function taskFromId(id: number): PingTask {
  return {
    id,
    interval: 60,
    name: `任务 #${id}`,
    loss: 0,
    clients: [],
    type: "icmp",
    target: "",
    weight: id,
  };
}

/**
 * `public:getPublicPingTasks` is a global catalog in official Komari, whereas
 * the older per-node Ping endpoint only returned tasks that applied to the
 * requested node. Preserve the latter page-level behaviour while retaining a
 * task that has historical points in the queried time window (it may have
 * been unbound after those points were recorded).
 */
function scopedOfficialPingTasks(
  tasks: z.infer<typeof OfficialPingTaskSchema>[],
  entityIds: string[],
  observedTaskIds: ReadonlySet<number>,
) {
  const requested = new Set(entityIds);
  const taskById = new Map<number, PingTask>();

  for (const task of tasks) {
    const appliesToRequestedNode = task.clients.some((uuid) => requested.has(uuid));
    if (!appliesToRequestedNode && !observedTaskIds.has(task.id)) continue;
    taskById.set(task.id, toPingTask(task));
  }

  for (const taskId of observedTaskIds) {
    if (!taskById.has(taskId)) taskById.set(taskId, taskFromId(taskId));
  }

  return Array.from(taskById.values()).sort((left, right) => left.id - right.id);
}

export async function getOfficialComparisonPingRecords({
  uuids,
  hours,
  range,
  maxPoints,
  options,
}: {
  uuids: string[];
  hours: number;
  range?: MetricTimeRange;
  maxPoints: number;
  options?: OfficialCallOptions;
}): Promise<PingRecordsResponse> {
  const entityIds = uniqueUuids(uuids);
  if (entityIds.length === 0) return { count: 0, records: [], tasks: [] };
  const window = resolveOfficialMetricWindow(hours, range);
  const [tasks, response] = await Promise.all([
    callOfficial("public:getPublicPingTasks", {}, z.array(OfficialPingTaskSchema), options),
    queryOfficialMetrics({
      metricKeys: [OFFICIAL_PING_LATENCY_METRIC, OFFICIAL_PING_LOSS_METRIC],
      uuids: entityIds,
      window,
      maxPoints,
      fillEmpty: false,
      aggregationByMetric: OFFICIAL_PING_AGGREGATION_BY_METRIC,
      options,
    }),
  ]);
  const records: PingRecord[] = [];
  const observedTaskIds = new Set<number>();
  const buckets = collectPingBuckets(response.series);
  for (const [uuid, byTask] of buckets) {
    for (const [taskId, byTime] of byTask) {
      observedTaskIds.add(taskId);
      for (const bucket of byTime.values()) {
        const record = bucketToPingRecord(uuid, taskId, bucket);
        if (record) records.push(record);
      }
    }
  }
  records.sort((left, right) => metricTimeKey(left.time) - metricTimeKey(right.time));

  return {
    count: records.length,
    records,
    tasks: scopedOfficialPingTasks(tasks, entityIds, observedTaskIds),
  };
}

function deriveOverviewStat(taskId: number, buckets: Iterable<PingBucket>): PingOverviewStat | null {
  let total = 0;
  let lost = 0;
  let weightedLatency = 0;
  let valid = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let latest = -1;
  let latestTime = 0;
  for (const bucket of buckets) {
    const resolved = resolvePingBucket(bucket);
    if (!resolved) continue;
    total += resolved.sampleCount;
    lost += resolved.lossCount;
    if (resolved.latency > 0) {
      valid += resolved.validCount;
      weightedLatency += resolved.latency * resolved.validCount;
      min = Math.min(min, resolved.latency);
      max = Math.max(max, resolved.latency);
      const time = metricTimeKey(bucket.time);
      if (time >= latestTime) {
        latestTime = time;
        latest = resolved.latency;
      }
    }
  }
  if (total <= 0) return null;
  return {
    name: `任务 #${taskId}`,
    total,
    lost,
    loss: (lost / total) * 100,
    min: Number.isFinite(min) ? min : 0,
    max,
    avg: valid > 0 ? weightedLatency / valid : 0,
    latest,
    tail: 0,
  };
}

export async function getOfficialPingOverviewForNodes(
  uuids: string[],
  options?: OfficialCallOptions,
): Promise<PingOverviewResult> {
  const entityIds = uniqueUuids(uuids);
  const window = resolveOfficialMetricWindow(1);
  if (entityIds.length === 0) {
    return { from: window.start.toISOString(), to: window.end.toISOString(), tasks: [], stats: {}, series: {} };
  }
  const [tasks, metricResponse, statsResponse] = await Promise.all([
    callOfficial("public:getPublicPingTasks", {}, z.array(OfficialPingTaskSchema), options),
    queryOfficialMetrics({
      metricKeys: [OFFICIAL_PING_LATENCY_METRIC, OFFICIAL_PING_LOSS_METRIC],
      uuids: entityIds,
      window,
      // The homepage intentionally has a fixed visual density of 24 trend buckets.
      maxPoints: 24,
      fillEmpty: true,
      aggregationByMetric: OFFICIAL_PING_AGGREGATION_BY_METRIC,
      options,
    }),
    callOfficial(
      "public:getPingMetricStats",
      {
        entity_ids: entityIds,
        start: window.start.toISOString(),
        end: window.end.toISOString(),
        max_points: 24,
      },
      OfficialPingStatsResponseSchema,
      options,
    ),
  ]);
  const buckets = collectPingBuckets(metricResponse.series);
  const observedTaskIds = new Set<number>();
  for (const stat of statsResponse.stats) {
    const taskId = typeof stat.task_id === "number"
      ? stat.task_id
      : Number.parseInt(stat.task_id, 10);
    if (entityIds.includes(stat.entity_id) && Number.isSafeInteger(taskId) && taskId > 0) {
      observedTaskIds.add(taskId);
    }
  }
  for (const byTask of buckets.values()) {
    for (const taskId of byTask.keys()) observedTaskIds.add(taskId);
  }
  const scopedTasks = scopedOfficialPingTasks(tasks, entityIds, observedTaskIds);
  const taskById = new Map(scopedTasks.map((task) => [task.id, task]));
  const stats: PingOverviewResult["stats"] = Object.fromEntries(entityIds.map((uuid) => [uuid, {}]));
  const series: PingOverviewResult["series"] = Object.fromEntries(entityIds.map((uuid) => [uuid, {}]));

  for (const stat of statsResponse.stats) {
    const taskId = typeof stat.task_id === "number"
      ? stat.task_id
      : Number.parseInt(stat.task_id, 10);
    if (!entityIds.includes(stat.entity_id) || !Number.isSafeInteger(taskId) || taskId <= 0) continue;
    if (!taskById.has(taskId)) taskById.set(taskId, taskFromId(taskId));
    const total = Math.max(0, Math.round(stat.total));
    const valid = Math.max(0, Math.min(total, Math.round(stat.valid)));
    stats[stat.entity_id][String(taskId)] = {
      name: stat.name || taskById.get(taskId)?.name || `任务 #${taskId}`,
      total,
      lost: Math.max(0, total - valid),
      loss: Math.max(0, stat.loss),
      min: stat.min ?? 0,
      max: stat.max ?? 0,
      avg: stat.avg ?? 0,
      latest: stat.latest ?? -1,
      tail: stat.p99_p50_ratio,
    };
  }

  for (const [uuid, byTask] of buckets) {
    if (!series[uuid]) continue;
    for (const [taskId, byTime] of byTask) {
      if (!taskById.has(taskId)) taskById.set(taskId, taskFromId(taskId));
      const points = Array.from(byTime.values())
        .map((bucket) => {
          const resolved = resolvePingBucket(bucket);
          if (!resolved) return null;
          return {
            time: bucket.time,
            value: resolved.latency,
            sample_count: resolved.sampleCount,
            loss_count: resolved.lossCount,
            loss: resolved.lossRate * 100,
          };
        })
        .filter((point): point is NonNullable<typeof point> => point != null)
        .sort((left, right) => metricTimeKey(left.time) - metricTimeKey(right.time));
      series[uuid][String(taskId)] = points;
      if (!stats[uuid][String(taskId)]) {
        const fallback = deriveOverviewStat(taskId, byTime.values());
        if (fallback) stats[uuid][String(taskId)] = fallback;
      }
    }
  }

  return {
    from: metricResponse.start ?? window.start.toISOString(),
    to: metricResponse.end ?? window.end.toISOString(),
    tasks: Array.from(taskById.values())
      .sort((left, right) => left.id - right.id)
      .map(({ id, name, type, interval }) => ({ id, name, type, interval })),
    stats,
    series,
  };
}
