import type { ComparisonLoadRecords, ComparisonLoadType } from "@/services/api";
import type { LoadRecord, NodeInfo, PingRecord, PingTask } from "@/types/komari";
import {
  formatLatency,
  formatLoadValue,
  formatMetricNumber,
  formatMetricPercent,
  formatPacketLoss,
  formatTrafficRateLabel,
  trimFixed,
} from "@/utils/format";
import {
  normalizeHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import { getPingRecordSampleCounts, isValidPingLatency } from "@/utils/pingSamples";
import { buildPingTaskVpsCompareUrl } from "@/utils/pingCompareLink";

export type ComparisonMetricKey =
  | "cpu"
  | "ram"
  | "disk"
  | "load"
  | "net_in"
  | "net_out"
  | "connections"
  | "ping_latency"
  | "ping_loss";

export type ComparisonMetricSource = "load" | "ping";
export type ComparisonAxisKind = "percent" | "network" | "count" | "latency" | "default";

export interface ComparisonMetricDefinition {
  key: ComparisonMetricKey;
  label: string;
  shortLabel: string;
  source: ComparisonMetricSource;
  axisKind: ComparisonAxisKind;
  unit: string;
  loadType?: ComparisonLoadType;
  higherIsRisk: boolean;
}

export interface ComparisonNode {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
}

export interface ComparisonPoint {
  time: number;
  value: number;
}

export interface ComparisonSeries {
  uuid: string;
  name: string;
  group: string;
  region: string;
  points: ComparisonPoint[];
}

export interface ComparisonTrendData {
  series: ComparisonSeries[];
  times: number[];
  valuesBySeries: Array<Array<number | null | undefined>>;
  bucketSeconds: number | null;
  smoothWindow: number;
  rawSamples: number;
}

export interface ComparisonRequestWindowInput {
  presetHours: number;
  customStart?: number | null;
  customEnd?: number | null;
  nowSeconds?: number;
  maxHours?: number | null;
}

export type { PingTaskVpsCompareUrlInput } from "@/utils/pingCompareLink";

export interface ComparisonStats {
  samples: number;
  average: number | null;
  min: number | null;
  max: number | null;
  p95: number | null;
  latest: number | null;
}

export interface ComparisonRankingRow extends ComparisonStats {
  uuid: string;
  name: string;
  group: string;
  region: string;
}

export type ComparisonRiskTone = "none" | "good" | "notice" | "warning" | "critical";

export interface ComparisonMultiMetricCell {
  metric: ComparisonMetricDefinition;
  stats: ComparisonStats;
  points: ComparisonPoint[];
  riskScore: number | null;
  riskTone: ComparisonRiskTone;
  primaryValue: number | null;
  tags: string[];
}

export interface ComparisonMultiMetricRow {
  uuid: string;
  name: string;
  group: string;
  region: string;
  cells: Partial<Record<ComparisonMetricKey, ComparisonMultiMetricCell>>;
  overallScore: number | null;
  alertCount: number;
  sampleCount: number;
  worstCell: ComparisonMultiMetricCell | null;
}

export interface ComparisonMultiMetricInsight {
  tone: ComparisonRiskTone;
  label: string;
  title: string;
  detail: string;
  uuid?: string;
  metricKey?: ComparisonMetricKey;
}

export interface ComparisonMultiMetricAnalysis {
  metricKeys: ComparisonMetricKey[];
  seriesByMetric: Partial<Record<ComparisonMetricKey, ComparisonSeries[]>>;
  rows: ComparisonMultiMetricRow[];
  insights: ComparisonMultiMetricInsight[];
}

export interface ComparisonMultiMetricInput {
  metricKeys: ComparisonMetricKey[];
  nodes: ComparisonNode[];
  loadRecordsByMetric?: Partial<Record<ComparisonMetricKey, ComparisonLoadRecords>>;
  pingRecords?: PingRecord[];
  pingTaskId?: number | null;
  range?: { start?: number | null; end?: number | null };
}

export interface ComparisonMultiMetricSeriesInput {
  metricKeys: ComparisonMetricKey[];
  nodes: ComparisonNode[];
  seriesByMetric: Partial<Record<ComparisonMetricKey, ComparisonSeries[]>>;
}

export type ComparisonRankingSortKey =
  | "name"
  | "group"
  | "region"
  | "samples"
  | "average"
  | "p95"
  | "max"
  | "latest";
export type ComparisonSortDirection = "asc" | "desc";

export const COMPARISON_METRICS: ComparisonMetricDefinition[] = [
  {
    key: "cpu",
    label: "CPU 使用率",
    shortLabel: "CPU",
    source: "load",
    axisKind: "percent",
    unit: "%",
    loadType: "cpu",
    higherIsRisk: true,
  },
  {
    key: "ram",
    label: "内存使用率",
    shortLabel: "内存",
    source: "load",
    axisKind: "percent",
    unit: "%",
    loadType: "ram",
    higherIsRisk: true,
  },
  {
    key: "disk",
    label: "磁盘使用率",
    shortLabel: "磁盘",
    source: "load",
    axisKind: "percent",
    unit: "%",
    loadType: "disk",
    higherIsRisk: true,
  },
  {
    key: "load",
    label: "系统负载",
    shortLabel: "负载",
    source: "load",
    axisKind: "default",
    unit: "",
    loadType: "load",
    higherIsRisk: true,
  },
  {
    key: "net_in",
    label: "下行速率",
    shortLabel: "下行",
    source: "load",
    axisKind: "network",
    unit: "B/s",
    loadType: "network",
    higherIsRisk: true,
  },
  {
    key: "net_out",
    label: "上行速率",
    shortLabel: "上行",
    source: "load",
    axisKind: "network",
    unit: "B/s",
    loadType: "network",
    higherIsRisk: true,
  },
  {
    key: "connections",
    label: "连接数",
    shortLabel: "连接",
    source: "load",
    axisKind: "count",
    unit: "",
    loadType: "connections",
    higherIsRisk: true,
  },
  {
    key: "ping_latency",
    label: "Ping 延迟",
    shortLabel: "延迟",
    source: "ping",
    axisKind: "latency",
    unit: "ms",
    higherIsRisk: true,
  },
  {
    key: "ping_loss",
    label: "Ping 丢包率",
    shortLabel: "丢包",
    source: "ping",
    axisKind: "percent",
    unit: "%",
    higherIsRisk: true,
  },
];

const METRIC_BY_KEY = new Map(COMPARISON_METRICS.map((metric) => [metric.key, metric]));
const COMPARISON_PING_TARGET_POINTS = 220;
const COMPARISON_LONG_GAP_BUCKETS = 3;
const COMPARISON_BUCKET_STEPS = [
  30,
  60,
  120,
  300,
  600,
  900,
  1_800,
  3_600,
  7_200,
  14_400,
  21_600,
  43_200,
  86_400,
] as const;

function clamp(value: number, min = 0, max = 100) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function getComparisonMetric(key: ComparisonMetricKey) {
  const metric = METRIC_BY_KEY.get(key);
  if (!metric) {
    throw new Error(`Unknown comparison metric: ${key}`);
  }
  return metric;
}

export function parseComparisonMetricKeys(
  value: string | null | undefined,
  fallback: ComparisonMetricKey = "cpu",
) {
  const parsed = value
    ? Array.from(
        new Set(
          value
            .split(",")
            .map((item) => item.trim())
            .filter((item): item is ComparisonMetricKey => METRIC_BY_KEY.has(item as ComparisonMetricKey)),
        ),
      )
    : [];
  return parsed.length > 0 ? parsed : [fallback];
}

export function toComparisonSeconds(value: string | number): number {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value / 1000 : value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function aggregateTrendBucket(metricKey: ComparisonMetricKey, values: number[]) {
  if (metricKey === "ping_latency") return median(values);
  return average(values);
}

function chooseComparisonBucketSeconds(metric: ComparisonMetricDefinition, rangeSeconds: number) {
  if (metric.source !== "ping") return null;
  const safeRange = Number.isFinite(rangeSeconds) && rangeSeconds > 0 ? rangeSeconds : 3_600;
  const desired = Math.max(60, Math.ceil(safeRange / COMPARISON_PING_TARGET_POINTS));
  return COMPARISON_BUCKET_STEPS.find((step) => step >= desired) ?? 86_400;
}

function chooseComparisonSmoothWindow(metricKey: ComparisonMetricKey, bucketSeconds: number | null) {
  if (bucketSeconds == null) return 1;
  if (metricKey === "ping_latency") return bucketSeconds <= 60 ? 5 : 3;
  if (metricKey === "ping_loss") return bucketSeconds <= 120 ? 3 : 1;
  return 1;
}

function smoothTrendValues(
  values: Array<number | null | undefined>,
  windowPoints: number,
): Array<number | null | undefined> {
  if (windowPoints <= 1) return values;
  const numericCount = values.filter((value) => typeof value === "number" && Number.isFinite(value)).length;
  if (numericCount < Math.max(3, windowPoints)) return values;
  const half = Math.floor(windowPoints / 2);
  return values.map((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    let sum = 0;
    let count = 0;
    for (
      let pointer = Math.max(0, index - half);
      pointer <= Math.min(values.length - 1, index + half);
      pointer += 1
    ) {
      const nearby = values[pointer];
      if (typeof nearby === "number" && Number.isFinite(nearby)) {
        sum += nearby;
        count += 1;
      }
    }
    return count > 0 ? sum / count : value;
  });
}

function breakLongTrendGaps(
  values: Array<number | null | undefined>,
): Array<number | null | undefined> {
  const out = values.slice();
  let previousNumericIndex = -1;
  for (let index = 0; index < out.length; index += 1) {
    const value = out[index];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    if (previousNumericIndex >= 0 && index - previousNumericIndex > COMPARISON_LONG_GAP_BUCKETS) {
      const breakIndex = previousNumericIndex + 1;
      if (out[breakIndex] === undefined) out[breakIndex] = null;
    }
    previousNumericIndex = index;
  }
  return out;
}

export function isValidComparisonCustomRange(
  start: number | null | undefined,
  end: number | null | undefined,
) {
  return (
    typeof start === "number" &&
    typeof end === "number" &&
    Number.isFinite(start) &&
    Number.isFinite(end) &&
    end > start
  );
}

export function getComparisonRequestHours({
  presetHours,
  customStart,
  customEnd,
  nowSeconds = Date.now() / 1000,
  maxHours,
}: ComparisonRequestWindowInput) {
  const maxSafeHours =
    typeof maxHours === "number" && Number.isFinite(maxHours) && maxHours > 0
      ? Math.floor(maxHours)
      : null;
  const clampToMax = (hours: number) =>
    maxSafeHours == null ? hours : Math.min(hours, maxSafeHours);

  if (!isValidComparisonCustomRange(customStart, customEnd)) {
    return clampToMax(Math.max(1, Math.ceil(presetHours)));
  }

  const safeNow = Number.isFinite(nowSeconds) ? nowSeconds : Date.now() / 1000;
  const rangeStart = Number(customStart);
  const spanFromNow = Math.max(1, safeNow - rangeStart);
  return clampToMax(Math.max(1, Math.ceil(spanFromNow / 3_600)));
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeComparisonPingTaskId(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function filterPingRecordsByTask(
  records: PingRecord[],
  taskId: number | null | undefined,
) {
  const normalizedTaskId = normalizeComparisonPingTaskId(taskId);
  if (normalizedTaskId == null) return records;
  return records.filter((record) => record.task_id === normalizedTaskId);
}

export function getPingTaskBoundNodeUuids(
  bindings: HomepagePingTaskBindings,
  taskId: number | null | undefined,
  visibleUuids?: string[],
) {
  const normalizedTaskId = normalizeComparisonPingTaskId(taskId);
  if (normalizedTaskId == null) return [];
  const normalizedBindings = normalizeHomepagePingTaskBindings(bindings);
  const visibleSet = visibleUuids ? new Set(visibleUuids) : null;
  return Array.from(new Set(normalizedBindings[String(normalizedTaskId)] ?? []))
    .filter((uuid) => !visibleSet || visibleSet.has(uuid));
}

export { buildPingTaskVpsCompareUrl };

function pingTaskMetadataScore(task: PingTask) {
  const name = task.name?.trim() ?? "";
  const fallbackName = `任务 #${task.id}`;
  let score = 0;
  if (name && name !== fallbackName) score += 8;
  else if (name) score += 1;
  if (task.target?.trim()) score += 4;
  if (task.clients.length > 0) score += 2;
  if (task.type?.trim()) score += 1;
  if (Number.isFinite(task.interval) && task.interval > 0) score += 1;
  return score;
}

export function mergePingTasksById(taskLists: Array<PingTask[] | undefined>) {
  const taskById = new Map<number, PingTask>();
  for (const tasks of taskLists) {
    for (const task of tasks ?? []) {
      const taskId = normalizeComparisonPingTaskId(task.id);
      if (taskId == null) continue;
      const existing = taskById.get(taskId);
      if (!existing || pingTaskMetadataScore(task) > pingTaskMetadataScore(existing)) {
        taskById.set(taskId, task);
      }
    }
  }
  return taskById;
}

function percent(used: number, total: number) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
  return (used / total) * 100;
}

function getLoadMetricValue(metric: ComparisonMetricKey, record: LoadRecord) {
  switch (metric) {
    case "cpu":
      return normalizeNumber(record.cpu);
    case "ram":
      return percent(record.ram, record.ram_total);
    case "disk":
      return percent(record.disk, record.disk_total);
    case "load":
      return normalizeNumber(record.load);
    case "net_in":
      return normalizeNumber(record.net_in);
    case "net_out":
      return normalizeNumber(record.net_out);
    case "connections":
      return normalizeNumber((record.connections ?? 0) + (record.connections_udp ?? 0));
    default:
      return null;
  }
}

function buildLoadSeries(
  metric: ComparisonMetricDefinition,
  nodes: ComparisonNode[],
  recordsByUuid: ComparisonLoadRecords,
): ComparisonSeries[] {
  return nodes.map((node) => {
    const points = (recordsByUuid[node.uuid] ?? [])
      .map((record) => ({
        time: toComparisonSeconds(record.time),
        value: getLoadMetricValue(metric.key, record),
      }))
      .filter((point): point is ComparisonPoint =>
        point.time > 0 && point.value != null && Number.isFinite(point.value),
      )
      .sort((a, b) => a.time - b.time);

    return {
      uuid: node.uuid,
      name: node.name || node.uuid,
      group: String(node.group || ""),
      region: String(node.region || ""),
      points,
    };
  });
}

function buildPingPoints(metric: ComparisonMetricDefinition, records: PingRecord[]) {
  const buckets = new Map<number, {
    total: number;
    lost: number;
    weightedLoss: number;
    latencySum: number;
    latencyCount: number;
  }>();
  for (const record of records) {
    const time = toComparisonSeconds(record.time);
    if (time <= 0) continue;
    const bucket = buckets.get(time) ?? {
      total: 0,
      lost: 0,
      weightedLoss: 0,
      latencySum: 0,
      latencyCount: 0,
    };
    const { total, lost, valid } = getPingRecordSampleCounts(record);
    const lossRate = Number.isFinite(record.loss_rate) && record.loss_rate != null
      ? Math.max(0, Math.min(1, record.loss_rate))
      : lost / total;
    bucket.total += total;
    bucket.lost += lost;
    bucket.weightedLoss += lossRate * total;
    if (isValidPingLatency(record.value) && valid > 0) {
      bucket.latencySum += record.value * valid;
      bucket.latencyCount += valid;
    }
    buckets.set(time, bucket);
  }

  return Array.from(buckets.entries())
    .map(([time, bucket]) => {
      const value =
        metric.key === "ping_loss"
          ? (bucket.weightedLoss / Math.max(1, bucket.total)) * 100
          : bucket.latencyCount > 0
            ? bucket.latencySum / bucket.latencyCount
            : null;
      return { time, value };
    })
    .filter((point): point is ComparisonPoint =>
      point.value != null && Number.isFinite(point.value),
    )
    .sort((a, b) => a.time - b.time);
}

function buildPingSeries(
  metric: ComparisonMetricDefinition,
  nodes: ComparisonNode[],
  records: PingRecord[],
): ComparisonSeries[] {
  const recordsByUuid = new Map<string, PingRecord[]>();
  for (const record of records) {
    if (!record.client) continue;
    const list = recordsByUuid.get(record.client) ?? [];
    list.push(record);
    recordsByUuid.set(record.client, list);
  }

  return nodes.map((node) => ({
    uuid: node.uuid,
    name: node.name || node.uuid,
    group: String(node.group || ""),
    region: String(node.region || ""),
    points: buildPingPoints(metric, recordsByUuid.get(node.uuid) ?? []),
  }));
}

export function buildPingTaskComparisonSeries({
  metricKey,
  node,
  records,
  tasks,
  taskIds,
}: {
  metricKey: ComparisonMetricKey;
  node: ComparisonNode;
  records: PingRecord[];
  tasks: PingTask[];
  taskIds: number[];
}): ComparisonSeries[] {
  const metric = getComparisonMetric(metricKey);
  if (metric.source !== "ping") return [];

  const normalizedTaskIds = Array.from(new Set(taskIds))
    .filter((taskId) => Number.isInteger(taskId) && taskId > 0)
    .sort((left, right) => left - right);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const recordsByTask = new Map<number, PingRecord[]>();
  for (const record of records) {
    if (record.client && record.client !== node.uuid) continue;
    if (!normalizedTaskIds.includes(record.task_id)) continue;
    const list = recordsByTask.get(record.task_id) ?? [];
    list.push(record);
    recordsByTask.set(record.task_id, list);
  }

  return normalizedTaskIds.map((taskId) => {
    const task = taskById.get(taskId);
    const target = task?.target?.trim() ?? "";
    return {
      uuid: `${node.uuid}:ping:${taskId}`,
      name: task?.name?.trim() || `任务 #${taskId}`,
      group: node.name || node.uuid,
      region: target || String(taskId),
      points: buildPingPoints(metric, recordsByTask.get(taskId) ?? []),
    };
  });
}

export function buildPingTaskVpsComparisonSeries({
  metricKey,
  nodes,
  records,
  taskId,
}: {
  metricKey: ComparisonMetricKey;
  nodes: ComparisonNode[];
  records: PingRecord[];
  taskId: number | null | undefined;
}): ComparisonSeries[] {
  const metric = getComparisonMetric(metricKey);
  if (metric.source !== "ping") return [];
  return buildPingSeries(metric, nodes, filterPingRecordsByTask(records, taskId));
}

export function buildComparisonSeries({
  metricKey,
  nodes,
  loadRecords = {},
  pingRecords = [],
}: {
  metricKey: ComparisonMetricKey;
  nodes: ComparisonNode[];
  loadRecords?: ComparisonLoadRecords;
  pingRecords?: PingRecord[];
}): ComparisonSeries[] {
  const metric = getComparisonMetric(metricKey);
  return metric.source === "load"
    ? buildLoadSeries(metric, nodes, loadRecords)
    : buildPingSeries(metric, nodes, pingRecords);
}

function uniqueMetricKeys(metricKeys: ComparisonMetricKey[]) {
  const out: ComparisonMetricKey[] = [];
  const seen = new Set<ComparisonMetricKey>();
  for (const key of metricKeys) {
    if (!METRIC_BY_KEY.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function buildSeriesForMultiMetric({
  metricKey,
  nodes,
  loadRecordsByMetric,
  pingRecords,
  pingTaskId,
}: {
  metricKey: ComparisonMetricKey;
  nodes: ComparisonNode[];
  loadRecordsByMetric: Partial<Record<ComparisonMetricKey, ComparisonLoadRecords>>;
  pingRecords: PingRecord[];
  pingTaskId?: number | null;
}) {
  const metric = getComparisonMetric(metricKey);
  if (metric.source === "ping" && pingTaskId != null) {
    return buildPingTaskVpsComparisonSeries({
      metricKey,
      nodes,
      records: pingRecords,
      taskId: pingTaskId,
    });
  }

  return buildComparisonSeries({
    metricKey,
    nodes,
    loadRecords: loadRecordsByMetric[metricKey] ?? {},
    pingRecords,
  });
}

function primaryStatValue(stats: ComparisonStats) {
  return stats.p95 ?? stats.average ?? stats.latest ?? stats.max ?? null;
}

function relativePrimaryMax(rows: ComparisonRankingRow[]) {
  return Math.max(
    0,
    ...rows
      .map((row) => primaryStatValue(row))
      .filter((value): value is number => value != null && Number.isFinite(value)),
  );
}

function scoreLatencyRisk(value: number) {
  if (value <= 80) return clamp(value / 8);
  if (value <= 200) return clamp(10 + ((value - 80) / 120) * 25);
  if (value <= 500) return clamp(35 + ((value - 200) / 300) * 35);
  if (value <= 1000) return clamp(70 + ((value - 500) / 500) * 20);
  return clamp(90 + ((value - 1000) / 1000) * 10);
}

function scoreMetricRisk(
  metricKey: ComparisonMetricKey,
  stats: ComparisonStats,
  metricPrimaryMax: number,
) {
  const value = primaryStatValue(stats);
  if (value == null || !Number.isFinite(value)) return null;

  switch (metricKey) {
    case "cpu":
    case "ram":
    case "disk":
      return clamp(value);
    case "ping_loss":
      return clamp(value * 4);
    case "ping_latency":
      return scoreLatencyRisk(value);
    case "load":
      return clamp(value * 25);
    case "net_in":
    case "net_out":
    case "connections":
      return metricPrimaryMax > 0 ? clamp((value / metricPrimaryMax) * 100) : null;
    default:
      return clamp(value);
  }
}

function riskTone(score: number | null): ComparisonRiskTone {
  if (score == null || !Number.isFinite(score)) return "none";
  if (score >= 75) return "critical";
  if (score >= 55) return "warning";
  if (score >= 30) return "notice";
  return "good";
}

function cellTags({
  metricKey,
  stats,
  riskScore,
  maxSamples,
}: {
  metricKey: ComparisonMetricKey;
  stats: ComparisonStats;
  riskScore: number | null;
  maxSamples: number;
}) {
  const tags: string[] = [];
  if (stats.samples === 0) return ["无样本"];
  if (maxSamples > 0 && stats.samples < Math.max(3, maxSamples * 0.45)) tags.push("样本少");
  if (metricKey === "ping_loss" && (stats.p95 ?? stats.average ?? 0) > 0) tags.push("丢包");

  const averageValue = stats.average ?? 0;
  const maxValue = stats.max ?? 0;
  if (averageValue > 0 && maxValue > averageValue * 1.8) tags.push("峰");
  if (stats.p95 != null && stats.average != null && stats.p95 > stats.average * 1.35) tags.push("抖");
  if (riskScore != null && riskScore >= 75) tags.push("高风险");
  if (stats.latest != null && stats.max != null && stats.latest >= stats.max * 0.92 && riskScore != null && riskScore >= 55) {
    tags.push("最新高");
  }

  return Array.from(new Set(tags)).slice(0, 3);
}

function compareMultiRows(left: ComparisonMultiMetricRow, right: ComparisonMultiMetricRow) {
  const scoreDiff = compareNullableNumbers(right.overallScore, left.overallScore);
  if (scoreDiff !== 0) return scoreDiff;
  if (right.alertCount !== left.alertCount) return right.alertCount - left.alertCount;
  return compareRankingText(left.name, right.name) || left.uuid.localeCompare(right.uuid);
}

function strongestCell(row: ComparisonMultiMetricRow) {
  return Object.values(row.cells).reduce<ComparisonMultiMetricCell | null>((strongest, cell) => {
    if (!cell) return strongest;
    if (!strongest) return cell;
    return (cell.riskScore ?? -1) > (strongest.riskScore ?? -1) ? cell : strongest;
  }, null);
}

function buildMultiMetricInsights(rows: ComparisonMultiMetricRow[]) {
  const rowsWithScore = rows.filter((row) => row.overallScore != null);
  const worst = rowsWithScore[0];
  const best = [...rowsWithScore].reverse()[0];
  const mostAlerts = [...rowsWithScore].sort((left, right) =>
    right.alertCount - left.alertCount || compareMultiRows(left, right),
  )[0];
  const sampleRisk = rows.find((row) =>
    Object.values(row.cells).some((cell) => cell?.tags.includes("样本少") || cell?.tags.includes("无样本")),
  );

  const insights: ComparisonMultiMetricInsight[] = [];
  if (worst?.worstCell) {
    insights.push({
      tone: worst.worstCell.riskTone,
      label: "综合最差",
      title: worst.name,
      detail: `${worst.worstCell.metric.shortLabel} 拉高风险，综合分 ${Math.round(worst.overallScore ?? 0)}`,
      uuid: worst.uuid,
      metricKey: worst.worstCell.metric.key,
    });
  }
  if (best && best !== worst) {
    insights.push({
      tone: "good",
      label: "综合最佳",
      title: best.name,
      detail: `综合分 ${Math.round(best.overallScore ?? 0)}，选中指标整体更稳`,
      uuid: best.uuid,
      metricKey: best.worstCell?.metric.key,
    });
  }
  if (mostAlerts && mostAlerts.alertCount > 0) {
    insights.push({
      tone: mostAlerts.alertCount >= 3 ? "critical" : "warning",
      label: "异常最多",
      title: mostAlerts.name,
      detail: `${mostAlerts.alertCount} 个指标进入 warning/critical 区间`,
      uuid: mostAlerts.uuid,
      metricKey: mostAlerts.worstCell?.metric.key,
    });
  }
  if (sampleRisk) {
    insights.push({
      tone: "notice",
      label: "数据质量",
      title: sampleRisk.name,
      detail: "部分指标样本偏少，排序可信度需要结合原始趋势确认",
      uuid: sampleRisk.uuid,
    });
  }
  return insights.slice(0, 4);
}

export function buildMultiMetricComparisonAnalysis({
  metricKeys,
  nodes,
  loadRecordsByMetric = {},
  pingRecords = [],
  pingTaskId = null,
  range,
}: ComparisonMultiMetricInput): ComparisonMultiMetricAnalysis {
  const input = buildMultiMetricComparisonSeries({
    metricKeys,
    nodes,
    loadRecordsByMetric,
    pingRecords,
    pingTaskId,
    range,
  });
  return analyzeMultiMetricComparisonSeries(input);
}

export function buildMultiMetricComparisonSeries({
  metricKeys,
  nodes,
  loadRecordsByMetric = {},
  pingRecords = [],
  pingTaskId = null,
  range,
}: ComparisonMultiMetricInput): ComparisonMultiMetricSeriesInput {
  const normalizedMetricKeys = uniqueMetricKeys(metricKeys);
  const seriesByMetric: Partial<Record<ComparisonMetricKey, ComparisonSeries[]>> = {};

  for (const metricKey of normalizedMetricKeys) {
    const rawSeries = buildSeriesForMultiMetric({
      metricKey,
      nodes,
      loadRecordsByMetric,
      pingRecords,
      pingTaskId,
    });
    const series = trimComparisonSeriesToRange(rawSeries, range);
    seriesByMetric[metricKey] = series;
  }

  return { metricKeys: normalizedMetricKeys, nodes, seriesByMetric };
}

export function analyzeMultiMetricComparisonSeries({
  metricKeys,
  nodes,
  seriesByMetric,
}: ComparisonMultiMetricSeriesInput): ComparisonMultiMetricAnalysis {
  const normalizedMetricKeys = uniqueMetricKeys(metricKeys);
  const rankingByMetric = new Map<ComparisonMetricKey, ComparisonRankingRow[]>();
  for (const metricKey of normalizedMetricKeys) {
    rankingByMetric.set(metricKey, buildComparisonRanking(seriesByMetric[metricKey] ?? []));
  }

  const maxSamplesByMetric = new Map<ComparisonMetricKey, number>();
  const primaryMaxByMetric = new Map<ComparisonMetricKey, number>();
  for (const metricKey of normalizedMetricKeys) {
    const ranking = rankingByMetric.get(metricKey) ?? [];
    maxSamplesByMetric.set(metricKey, Math.max(0, ...ranking.map((row) => row.samples)));
    primaryMaxByMetric.set(metricKey, relativePrimaryMax(ranking));
  }

  const rows = nodes.map<ComparisonMultiMetricRow>((node) => {
    const cells: Partial<Record<ComparisonMetricKey, ComparisonMultiMetricCell>> = {};
    for (const metricKey of normalizedMetricKeys) {
      const metric = getComparisonMetric(metricKey);
      const series = (seriesByMetric[metricKey] ?? []).find((item) => item.uuid === node.uuid);
      const stats = getComparisonStats(series?.points ?? []);
      const riskScore = scoreMetricRisk(metricKey, stats, primaryMaxByMetric.get(metricKey) ?? 0);
      const cell: ComparisonMultiMetricCell = {
        metric,
        stats,
        points: series?.points ?? [],
        riskScore,
        riskTone: riskTone(riskScore),
        primaryValue: primaryStatValue(stats),
        tags: cellTags({
          metricKey,
          stats,
          riskScore,
          maxSamples: maxSamplesByMetric.get(metricKey) ?? 0,
        }),
      };
      cells[metricKey] = cell;
    }

    const scoredCells = Object.values(cells).filter(
      (cell): cell is ComparisonMultiMetricCell =>
        Boolean(cell) && cell.riskScore != null && Number.isFinite(cell.riskScore),
    );
    const overallScore =
      scoredCells.length > 0
        ? scoredCells.reduce((total, cell) => total + Number(cell.riskScore), 0) / scoredCells.length
        : null;
    const row: ComparisonMultiMetricRow = {
      uuid: node.uuid,
      name: node.name || node.uuid,
      group: String(node.group || ""),
      region: String(node.region || ""),
      cells,
      overallScore,
      alertCount: scoredCells.filter((cell) => (cell.riskScore ?? 0) >= 55).length,
      sampleCount: Object.values(cells).reduce((total, cell) => total + (cell?.stats.samples ?? 0), 0),
      worstCell: null,
    };
    row.worstCell = strongestCell(row);
    return row;
  }).sort(compareMultiRows);

  return {
    metricKeys: normalizedMetricKeys,
    seriesByMetric,
    rows,
    insights: buildMultiMetricInsights(rows),
  };
}

function filterComparisonPoints(
  points: ComparisonPoint[],
  start: number | null | undefined,
  end: number | null | undefined,
) {
  return points.filter((point) => {
    if (start != null && point.time < start) return false;
    if (end != null && point.time > end) return false;
    return true;
  });
}

export function trimComparisonSeriesToRange(
  series: ComparisonSeries[],
  range?: { start?: number | null; end?: number | null },
): ComparisonSeries[] {
  if (!range || (range.start == null && range.end == null)) return series;
  return series.map((item) => ({
    ...item,
    points: filterComparisonPoints(item.points, range.start, range.end),
  }));
}

function alignExactComparisonSeries(series: ComparisonSeries[]): ComparisonTrendData {
  const times = Array.from(
    new Set(series.flatMap((item) => item.points.map((point) => point.time))),
  ).sort((a, b) => a - b);
  const valueMaps = series.map(
    (item) => new Map(item.points.map((point) => [point.time, point.value])),
  );
  return {
    series,
    times,
    valuesBySeries: valueMaps.map((map) => times.map((time) => map.get(time) ?? null)),
    bucketSeconds: null,
    smoothWindow: 1,
    rawSamples: series.reduce((total, item) => total + item.points.length, 0),
  };
}

function resolveTrendExtent({
  series,
  hours,
  start,
  end,
}: {
  series: ComparisonSeries[];
  hours: number;
  start?: number | null;
  end?: number | null;
}) {
  const allTimes = series.flatMap((item) => item.points.map((point) => point.time));
  const minTime = allTimes.length ? Math.min(...allTimes) : null;
  const maxTime = allTimes.length ? Math.max(...allTimes) : null;
  const resolvedEnd = end ?? maxTime;
  if (resolvedEnd == null || !Number.isFinite(resolvedEnd)) return null;

  const fallbackStart = resolvedEnd - Math.max(1, hours) * 3_600;
  const resolvedStart = start ?? (minTime == null ? fallbackStart : Math.max(fallbackStart, minTime));
  if (!Number.isFinite(resolvedStart) || resolvedStart >= resolvedEnd) return null;
  return { start: resolvedStart, end: resolvedEnd };
}

export function prepareComparisonTrendData({
  metricKey,
  series,
  hours,
  start,
  end,
}: {
  metricKey: ComparisonMetricKey;
  series: ComparisonSeries[];
  hours: number;
  start?: number | null;
  end?: number | null;
}): ComparisonTrendData {
  const metric = getComparisonMetric(metricKey);
  const rangedSeries = trimComparisonSeriesToRange(series, { start, end });
  const rawSamples = rangedSeries.reduce((total, item) => total + item.points.length, 0);
  if (metric.source !== "ping") {
    return alignExactComparisonSeries(rangedSeries);
  }

  const extent = resolveTrendExtent({ series: rangedSeries, hours, start, end });
  if (!extent) {
    return {
      series: rangedSeries,
      times: [],
      valuesBySeries: rangedSeries.map(() => []),
      bucketSeconds: chooseComparisonBucketSeconds(metric, Math.max(1, hours) * 3_600),
      smoothWindow: 1,
      rawSamples,
    };
  }

  const bucketSeconds = chooseComparisonBucketSeconds(metric, extent.end - extent.start) ?? 60;
  const smoothWindow = chooseComparisonSmoothWindow(metricKey, bucketSeconds);
  const bucketStart = Math.floor(extent.start / bucketSeconds) * bucketSeconds;
  const bucketEnd = Math.ceil(extent.end / bucketSeconds) * bucketSeconds;
  const bucketCount = Math.max(1, Math.floor((bucketEnd - bucketStart) / bucketSeconds) + 1);
  const times = Array.from(
    { length: bucketCount },
    (_, index) => bucketStart + index * bucketSeconds,
  );

  const valuesBySeries = rangedSeries.map((item) => {
    const buckets = new Map<number, number[]>();
    for (const point of item.points) {
      if (point.time < extent.start || point.time > extent.end) continue;
      const index = Math.min(
        bucketCount - 1,
        Math.max(0, Math.floor((point.time - bucketStart) / bucketSeconds)),
      );
      const bucket = buckets.get(index) ?? [];
      bucket.push(point.value);
      buckets.set(index, bucket);
    }

    const bucketed = times.map((_, index) => {
      const values = buckets.get(index);
      return values ? aggregateTrendBucket(metricKey, values) : undefined;
    });
    return smoothTrendValues(breakLongTrendGaps(bucketed), smoothWindow);
  });

  return {
    series: rangedSeries,
    times,
    valuesBySeries,
    bucketSeconds,
    smoothWindow,
    rawSamples,
  };
}

function percentile(sortedValues: number[], ratio: number) {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];

  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];

  const weight = position - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

export function getComparisonStats(points: ComparisonPoint[]): ComparisonStats {
  const values = points
    .map((point) => point.value)
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (values.length === 0) {
    return {
      samples: 0,
      average: null,
      min: null,
      max: null,
      p95: null,
      latest: null,
    };
  }

  const sum = values.reduce((total, value) => total + value, 0);
  const latest = points
    .slice()
    .reverse()
    .find((point) => Number.isFinite(point.value))?.value ?? null;

  return {
    samples: values.length,
    average: sum / values.length,
    min: values[0],
    max: values[values.length - 1],
    p95: percentile(values, 0.95),
    latest,
  };
}

export function buildComparisonRanking(series: ComparisonSeries[]): ComparisonRankingRow[] {
  return series
    .map((item) => ({
      uuid: item.uuid,
      name: item.name,
      group: item.group,
      region: item.region,
      ...getComparisonStats(item.points),
    }))
    .sort((a, b) => {
      const av = a.p95 ?? a.average ?? -Infinity;
      const bv = b.p95 ?? b.average ?? -Infinity;
      return bv - av;
    });
}

function compareNullableNumbers(
  left: number | null | undefined,
  right: number | null | undefined,
) {
  const leftValid = typeof left === "number" && Number.isFinite(left);
  const rightValid = typeof right === "number" && Number.isFinite(right);
  if (!leftValid && !rightValid) return 0;
  if (!leftValid) return 1;
  if (!rightValid) return -1;
  return left - right;
}

function compareRankingText(left: string, right: string) {
  const leftText = left.trim();
  const rightText = right.trim();
  if (!leftText && !rightText) return 0;
  if (!leftText) return 1;
  if (!rightText) return -1;
  return leftText.localeCompare(rightText, "zh-CN", { numeric: true, sensitivity: "base" });
}

function compareRankingRowsByKey(
  left: ComparisonRankingRow,
  right: ComparisonRankingRow,
  key: ComparisonRankingSortKey,
) {
  switch (key) {
    case "name":
      return compareRankingText(left.name, right.name);
    case "group":
      return compareRankingText(left.group, right.group);
    case "region":
      return compareRankingText(left.region, right.region);
    case "samples":
      return compareNullableNumbers(left.samples, right.samples);
    case "average":
      return compareNullableNumbers(left.average, right.average);
    case "p95":
      return compareNullableNumbers(left.p95, right.p95);
    case "max":
      return compareNullableNumbers(left.max, right.max);
    case "latest":
      return compareNullableNumbers(left.latest, right.latest);
    default:
      return 0;
  }
}

function rankingNumberValue(row: ComparisonRankingRow, key: ComparisonRankingSortKey) {
  switch (key) {
    case "samples":
      return row.samples;
    case "average":
      return row.average;
    case "p95":
      return row.p95;
    case "max":
      return row.max;
    case "latest":
      return row.latest;
    default:
      return null;
  }
}

function rankingTextValue(row: ComparisonRankingRow, key: ComparisonRankingSortKey) {
  if (key === "name") return row.name;
  if (key === "group") return row.group;
  if (key === "region") return row.region;
  return null;
}

function hasComparableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value);
}

export function sortComparisonRankingRows(
  rows: ComparisonRankingRow[],
  key: ComparisonRankingSortKey,
  direction: ComparisonSortDirection,
) {
  const directionFactor = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const primary = compareRankingRowsByKey(left, right, key);
    if (primary !== 0) {
      const leftNumber = rankingNumberValue(left, key);
      const rightNumber = rankingNumberValue(right, key);
      const numberHasEmpty = hasComparableNumber(leftNumber) !== hasComparableNumber(rightNumber);
      if (numberHasEmpty) return primary;

      const leftText = rankingTextValue(left, key);
      const rightText = rankingTextValue(right, key);
      const textHasEmpty = leftText != null && rightText != null && !leftText.trim() !== !rightText.trim();
      if (textHasEmpty) return primary;

      return primary * directionFactor;
    }
    return (
      compareRankingText(left.name, right.name) ||
      compareRankingText(left.group, right.group) ||
      compareRankingText(left.region, right.region) ||
      left.uuid.localeCompare(right.uuid, "zh-CN", { numeric: true, sensitivity: "base" })
    );
  });
}

export function formatComparisonValue(
  metricKey: ComparisonMetricKey,
  value: number | null | undefined,
) {
  if (value == null || !Number.isFinite(value)) return "--";
  const metric = getComparisonMetric(metricKey);
  if (metric.axisKind === "network") return formatTrafficRateLabel(value);
  if (metric.key === "ping_loss") return formatPacketLoss(value);
  if (metric.axisKind === "percent") return formatMetricPercent(value);
  if (metric.axisKind === "count") return `${Math.round(value)}`;
  if (metric.axisKind === "latency") return formatLatency(value);
  if (metric.key === "load") return formatLoadValue(value);
  return formatMetricNumber(value);
}

function csvEscape(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rawValue(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? "" : trimFixed(value, 4);
}

export function buildComparisonCsv(
  rows: ComparisonRankingRow[],
  metricKey: ComparisonMetricKey,
) {
  const metric = getComparisonMetric(metricKey);
  const headers = [
    "metric",
    "name",
    "uuid",
    "group",
    "region",
    "samples",
    "average",
    "p95",
    "max",
    "latest",
  ];
  const lines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        metric.label,
        row.name,
        row.uuid,
        row.group,
        row.region,
        row.samples,
        rawValue(row.average),
        rawValue(row.p95),
        rawValue(row.max),
        rawValue(row.latest),
      ]
        .map(csvEscape)
        .join(","),
    ),
  ];
  return lines.join("\n");
}

export function buildComparisonMarkdown(
  rows: ComparisonRankingRow[],
  metricKey: ComparisonMetricKey,
) {
  const metric = getComparisonMetric(metricKey);
  const lines = [
    `## VPS 对比 - ${metric.label}`,
    "",
    "| VPS | 分组 | 地区 | 样本 | 平均 | P95 | 峰值 | 最新 |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) =>
      [
        row.name,
        row.group || "-",
        row.region || "-",
        row.samples,
        formatComparisonValue(metricKey, row.average),
        formatComparisonValue(metricKey, row.p95),
        formatComparisonValue(metricKey, row.max),
        formatComparisonValue(metricKey, row.latest),
      ].join(" | "),
    ).map((line) => `| ${line} |`),
  ];
  return lines.join("\n");
}

export function buildMultiMetricComparisonCsv(analysis: ComparisonMultiMetricAnalysis) {
  const metricColumns = analysis.metricKeys.flatMap((metricKey) => {
    const metric = getComparisonMetric(metricKey);
    return [
      `${metric.shortLabel}_primary`,
      `${metric.shortLabel}_average`,
      `${metric.shortLabel}_p95`,
      `${metric.shortLabel}_max`,
      `${metric.shortLabel}_latest`,
      `${metric.shortLabel}_risk`,
      `${metric.shortLabel}_tags`,
    ];
  });
  const headers = [
    "name",
    "uuid",
    "group",
    "region",
    "overall_score",
    "alert_count",
    "samples",
    "worst_metric",
    ...metricColumns,
  ];
  const lines = [
    headers.join(","),
    ...analysis.rows.map((row) => {
      const metricValues = analysis.metricKeys.flatMap((metricKey) => {
        const cell = row.cells[metricKey];
        return [
          rawValue(cell?.primaryValue),
          rawValue(cell?.stats.average),
          rawValue(cell?.stats.p95),
          rawValue(cell?.stats.max),
          rawValue(cell?.stats.latest),
          rawValue(cell?.riskScore),
          cell?.tags.join(" ") ?? "",
        ];
      });
      return [
        row.name,
        row.uuid,
        row.group,
        row.region,
        rawValue(row.overallScore),
        row.alertCount,
        row.sampleCount,
        row.worstCell?.metric.shortLabel ?? "",
        ...metricValues,
      ]
        .map(csvEscape)
        .join(",");
    }),
  ];
  return lines.join("\n");
}

export function buildMultiMetricComparisonMarkdown(analysis: ComparisonMultiMetricAnalysis) {
  const metricHeaders = analysis.metricKeys.map((metricKey) => getComparisonMetric(metricKey).shortLabel);
  const lines = [
    "## VPS 多指标对比",
    "",
    [
      "| VPS",
      "综合风险",
      "异常指标",
      "样本",
      "最差指标",
      ...metricHeaders,
    ].join(" | ") + " |",
    [
      "| ---",
      "---:",
      "---:",
      "---:",
      "---",
      ...metricHeaders.map(() => "---:"),
    ].join(" | ") + " |",
    ...analysis.rows.map((row) => {
      const metricValues = analysis.metricKeys.map((metricKey) => {
        const cell = row.cells[metricKey];
        if (!cell) return "--";
        const score = cell.riskScore != null ? Math.round(cell.riskScore) : "--";
        return `${formatComparisonValue(metricKey, cell.primaryValue)} / ${score}`;
      });
      return [
        row.name,
        row.overallScore != null ? Math.round(row.overallScore) : "--",
        row.alertCount,
        row.sampleCount,
        row.worstCell?.metric.shortLabel ?? "--",
        ...metricValues,
      ].join(" | ");
    }).map((line) => `| ${line} |`),
  ];
  return lines.join("\n");
}

export function nodesToComparisonNodes(nodes: NodeInfo[]): ComparisonNode[] {
  return nodes.map((node) => ({
    uuid: node.uuid,
    name: node.name,
    group: node.group,
    region: node.region,
  }));
}
