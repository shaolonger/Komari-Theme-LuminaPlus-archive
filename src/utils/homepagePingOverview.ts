import type { PingOverviewItem, PingOverviewTaskSummary, PingTask } from "@/types/komari";
import {
  DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY,
  type HomepagePingAggregationStrategy,
} from "@/utils/homepagePingSettings";
import { isLostPingSample, isValidPingLatency } from "@/utils/pingSamples";

export const HOMEPAGE_PING_WINDOW_HOURS = 1;
export const HOMEPAGE_PING_WINDOW_LABEL = "近 1 小时";

interface TaskRecord {
  task_id: number;
  time: string | number;
  value: number;
  client: string;
}

export function toPingRecordTimestamp(value: string | number) {
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function taskLabel(taskId: number, task?: PingTask) {
  return task?.name?.trim() || `任务 #${taskId}`;
}

function taskTarget(task?: PingTask) {
  return task?.target?.trim() || "";
}

function summarizeTask(
  taskId: number,
  task: PingTask | undefined,
  item: PingOverviewItem | undefined,
): PingOverviewTaskSummary {
  return {
    taskId,
    name: taskLabel(taskId, task),
    target: taskTarget(task),
    lastValue: item?.lastValue ?? null,
    loss: item?.loss ?? null,
    sampleCount: item?.samples.length ?? 0,
    hasSamples: Boolean(item && (item.samples.length > 0 || item.values.length > 0)),
    samples: item?.samples ?? [],
  };
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function aggregateCurrentValues({
  values,
  strategy,
  primaryTaskId,
}: {
  values: Array<{ taskId: number; value: number }>;
  strategy: HomepagePingAggregationStrategy;
  primaryTaskId?: number | null;
}) {
  if (values.length === 0) return null;
  if (strategy === "average") {
    return average(values.map((item) => item.value));
  }
  if (strategy === "primary" && primaryTaskId != null) {
    const primary = values.find((item) => item.taskId === primaryTaskId);
    if (primary) return primary.value;
  }
  return Math.max(...values.map((item) => item.value));
}

export function buildHomepagePingAssignmentKey(
  selectedTaskIdsByClient: Map<string, number[]>,
) {
  return Array.from(selectedTaskIdsByClient.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([uuid, taskIds]) =>
        `${uuid}:${[...taskIds].sort((left, right) => left - right).join(",")}`,
    )
    .join("|");
}

export function buildPingOverviewItemsForTask(
  taskId: number,
  records: TaskRecord[],
  task?: PingTask,
) {
  const selectedRecords = records.filter((record) => record.task_id === taskId);
  const grouped = new Map<string, TaskRecord[]>();
  const lossStatsByClient = new Map<string, { total: number; lost: number }>();

  for (const record of selectedRecords) {
    if (!record.client) continue;
    const current = grouped.get(record.client);
    if (current) current.push(record);
    else grouped.set(record.client, [record]);

    const stats = lossStatsByClient.get(record.client) ?? { total: 0, lost: 0 };
    stats.total += 1;
    if (isLostPingSample(record.value)) {
      stats.lost += 1;
    }
    lossStatsByClient.set(record.client, stats);
  }

  const result = new Map<string, PingOverviewItem>();
  for (const [client, clientRecords] of grouped) {
    const sorted = [...clientRecords].sort(
      (left, right) => toPingRecordTimestamp(left.time) - toPingRecordTimestamp(right.time),
    );
    const latestRecord = sorted[sorted.length - 1];
    const values: number[] = new Array(sorted.length);
    const samples: Array<{ time: number; value: number }> = [];
    let max = 1;

    for (let i = 0; i < sorted.length; i++) {
      const record = sorted[i];
      const value = record.value;
      const time = toPingRecordTimestamp(record.time);
      values[i] = value;
      if (time > 0) {
        samples.push({ time, value });
      }
      if (isValidPingLatency(value) && value > max) {
        max = value;
      }
    }

    const lossStats = lossStatsByClient.get(client);
    const item: PingOverviewItem = {
      client,
      isAssigned: true,
      lastValue: latestRecord && isValidPingLatency(latestRecord.value) ? latestRecord.value : null,
      values,
      samples,
      max,
      loss: lossStats?.total ? (lossStats.lost / lossStats.total) * 100 : null,
      taskIds: [taskId],
      taskCount: 1,
      taskSummaries: [],
    };
    item.taskSummaries = [summarizeTask(taskId, task, item)];
    result.set(client, item);
  }

  return result;
}

export function aggregateHomepagePingOverviewItem(options: {
  client: string;
  taskIds: number[];
  itemsByTask: Map<number, Map<string, PingOverviewItem>>;
  tasksById?: Map<number, PingTask>;
  aggregationStrategy?: HomepagePingAggregationStrategy;
  primaryTaskId?: number | null;
}): PingOverviewItem {
  const { client, itemsByTask, tasksById } = options;
  const aggregationStrategy =
    options.aggregationStrategy ?? DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY;
  const taskIds = Array.from(new Set(options.taskIds))
    .filter((taskId) => Number.isInteger(taskId) && taskId > 0)
    .sort((left, right) => left - right);
  const primaryTaskId =
    options.primaryTaskId != null && taskIds.includes(options.primaryTaskId)
      ? options.primaryTaskId
      : null;
  const taskItems = taskIds.map((taskId) => ({
    taskId,
    item: itemsByTask.get(taskId)?.get(client),
  }));

  const samples = taskItems
    .flatMap(({ taskId, item }) =>
      (item?.samples ?? []).map((sample) => ({ ...sample, taskId })),
    )
    .sort((left, right) => left.time - right.time || left.taskId - right.taskId)
    .map(({ time, value, sampleCount, lossCount }) => ({
      time,
      value,
      sampleCount,
      lossCount,
    }));
  const values = taskItems.flatMap(({ item }) => item?.values ?? []);
  const currentLatencies = taskItems
    .map(({ taskId, item }) => ({ taskId, value: item?.lastValue }))
    .filter(
      (item): item is { taskId: number; value: number } =>
        isValidPingLatency(item.value),
    );
  const losses = taskItems
    .map(({ taskId, item }) => ({ taskId, value: item?.loss }))
    .filter(
      (item): item is { taskId: number; value: number } => item.value != null,
    );
  const max = Math.max(1, ...taskItems.map(({ item }) => item?.max ?? 1), ...values);

  return {
    client,
    isAssigned: taskIds.length > 0,
    lastValue: aggregateCurrentValues({
      values: currentLatencies,
      strategy: aggregationStrategy,
      primaryTaskId,
    }),
    values,
    samples,
    max,
    loss: aggregateCurrentValues({
      values: losses,
      strategy: aggregationStrategy,
      primaryTaskId,
    }),
    taskIds,
    taskCount: taskIds.length,
    taskSummaries: taskItems.map(({ taskId, item }) =>
      summarizeTask(taskId, tasksById?.get(taskId), item),
    ),
    aggregationStrategy,
    primaryTaskId,
  };
}
