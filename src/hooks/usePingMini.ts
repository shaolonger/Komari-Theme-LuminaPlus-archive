import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useVisibleNodeUuids } from "@/hooks/useNode";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getPingOverviewForNodes } from "@/services/api";
import type {
  PingOverviewBucket,
  PingOverviewItem,
  PingOverviewSample,
  PingTask,
} from "@/types/komari";
import { signalWithTimeout } from "@/utils/abort";
import {
  aggregateHomepagePingOverviewItem,
  buildHomepagePingAssignmentKey,
  HOMEPAGE_PING_WINDOW_HOURS,
	toPingRecordTimestamp,
} from "@/utils/homepagePingOverview";
import {
  DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY,
  type HomepagePingAggregationStrategy,
  type HomepagePingPrimaryTasks,
} from "@/utils/homepagePingSettings";
import {
  getHomepagePingTaskIdsByClient,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import { isValidPingLatency } from "@/utils/pingSamples";

const DEFAULT_PING_REFRESH_INTERVAL = 60_000;
const MIN_PING_REFRESH_INTERVAL = 10_000;
const MAX_PING_REFRESH_INTERVAL = 300_000;
// 首页 mini 图表特意固定为前端聚合的 24 个 bucket。首页卡片是用来快速看趋势的，
// 所以把最近一小时聚合成 24 等分窗口，而不是每根柱子对应一个后端原始 bucket。
const MAX_VISIBLE_HOMEPAGE_PING_BUCKETS = 24;

const EMPTY_PING: PingOverviewItem = {
  client: "",
  isAssigned: false,
  lastValue: null,
  values: [],
  samples: [],
  max: 1,
  loss: null,
  taskIds: [],
  taskCount: 0,
  taskSummaries: [],
  aggregationStrategy: DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY,
  primaryTaskId: null,
};

interface PingOverviewMapResult {
  assignmentKey: string;
  intervalMs: number;
  items: Map<string, PingOverviewItem>;
}

type Listener = () => void;
interface PingOverviewStoreEntry {
  item: PingOverviewItem;
  missingRounds: number;
}

const PING_OVERVIEW_MISSING_GRACE_ROUNDS = 1;

function normalizeRefreshInterval(seconds: number | null | undefined) {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) {
    return DEFAULT_PING_REFRESH_INTERVAL;
  }

  return Math.min(
    MAX_PING_REFRESH_INTERVAL,
    Math.max(MIN_PING_REFRESH_INTERVAL, seconds * 1000),
  );
}

function normalizeVisibleUuids(uuids: string[]) {
  return Array.from(new Set(uuids.filter(Boolean))).sort((left, right) =>
    left.localeCompare(right),
  );
}

function stringifyBindings(bindings: HomepagePingTaskBindings) {
  return JSON.stringify(
    Object.entries(bindings)
      .map(([taskId, clients]) => [taskId, [...clients].sort((left, right) => left.localeCompare(right))])
      .sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function stringifyPrimaryTasks(primaryTasks: HomepagePingPrimaryTasks) {
  return JSON.stringify(
    Object.entries(primaryTasks)
      .filter(([, taskId]) => Number.isInteger(taskId) && taskId > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function equalNumberArray(a: number[], b: number[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function equalSamples(
  a: PingOverviewSample[],
  b: PingOverviewSample[],
) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i]?.time !== b[i]?.time ||
      a[i]?.value !== b[i]?.value ||
      a[i]?.sampleCount !== b[i]?.sampleCount ||
      a[i]?.lossCount !== b[i]?.lossCount
    ) {
      return false;
    }
  }
  return true;
}

function equalTaskIds(a: number[] | undefined, b: number[] | undefined) {
  return equalNumberArray(a ?? [], b ?? []);
}

function equalTaskSummaries(
  a: PingOverviewItem["taskSummaries"],
  b: PingOverviewItem["taskSummaries"],
) {
  const left = a ?? [];
  const right = b ?? [];
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i++) {
    const leftSummary = left[i];
    const rightSummary = right[i];
    if (
      leftSummary.taskId !== rightSummary.taskId ||
      leftSummary.name !== rightSummary.name ||
      leftSummary.target !== rightSummary.target ||
      leftSummary.lastValue !== rightSummary.lastValue ||
      leftSummary.loss !== rightSummary.loss ||
      leftSummary.sampleCount !== rightSummary.sampleCount ||
      leftSummary.hasSamples !== rightSummary.hasSamples ||
      !equalSamples(leftSummary.samples ?? [], rightSummary.samples ?? [])
    ) {
      return false;
    }
  }
  return true;
}

function equalPingItem(a: PingOverviewItem | undefined, b: PingOverviewItem | undefined) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.client === b.client &&
    a.isAssigned === b.isAssigned &&
    a.lastValue === b.lastValue &&
    a.max === b.max &&
    a.loss === b.loss &&
    (a.taskCount ?? 0) === (b.taskCount ?? 0) &&
    (a.aggregationStrategy ?? DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY) ===
      (b.aggregationStrategy ?? DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY) &&
    (a.primaryTaskId ?? null) === (b.primaryTaskId ?? null) &&
    equalTaskIds(a.taskIds, b.taskIds) &&
    equalTaskSummaries(a.taskSummaries, b.taskSummaries) &&
    equalNumberArray(a.values, b.values) &&
    equalSamples(a.samples, b.samples)
  );
}

function resolveSelectedTasks(
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
) {
  const selectedTaskIdsByClient = new Map<string, number[]>();
  const bindingSelection = getHomepagePingTaskIdsByClient(bindings);

  for (const uuid of clientUuids) {
    const taskIds = bindingSelection.get(uuid);
    if (taskIds && taskIds.length > 0) {
      selectedTaskIdsByClient.set(uuid, taskIds);
    }
  }

  return selectedTaskIdsByClient;
}

// 单次 overview 请求的硬上限。RPC 传输自带 ~30s 限制，但 HTTP fallback（`apiGet`）
// 没有超时——没有这个保护，一旦 fallback fetch 卡死就永远不结束，`pingRefreshInFlight`
// 会一直为 true，把后续所有轮询都卡死。给每个请求加 race 才能保证整条链路能恢复。
const PING_REQUEST_TIMEOUT_MS = 35_000;

export async function buildHomepagePingOverviewMap(
  hours: number,
  clientUuids: string[],
  bindings: HomepagePingTaskBindings,
  aggregationStrategy: HomepagePingAggregationStrategy,
  primaryTasks: HomepagePingPrimaryTasks,
  signal?: AbortSignal,
): Promise<PingOverviewMapResult> {
	void hours; // The negotiated overview contract is intentionally fixed to one hour.
  const normalizedUuids = normalizeVisibleUuids(clientUuids);
  if (normalizedUuids.length === 0) {
    return {
      assignmentKey: "",
      intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
      items: new Map<string, PingOverviewItem>(),
    };
  }

  const selectedTaskIdsByClient = resolveSelectedTasks(normalizedUuids, bindings);
  const selectedTaskIds = Array.from(
    new Set(Array.from(selectedTaskIdsByClient.values()).flat()),
  ).sort((left, right) => left - right);

  if (selectedTaskIds.length === 0) {
    return {
      assignmentKey: "",
      intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
      items: new Map<string, PingOverviewItem>(),
    };
  }

  const requestSignal = signalWithTimeout(signal, PING_REQUEST_TIMEOUT_MS);
  const overview = await getPingOverviewForNodes(normalizedUuids, { signal: requestSignal });

  const itemsByTask = new Map<number, Map<string, PingOverviewItem>>();
  const tasksById = new Map<number, PingTask>();
  const unavailableTaskIds = new Set<number>(selectedTaskIds);
  const refreshIntervals: number[] = [];

  for (const compactTask of overview.tasks) {
    if (!selectedTaskIds.includes(compactTask.id)) continue;
    const task: PingTask = {
      ...compactTask,
      loss: 0,
      clients: normalizedUuids.filter((uuid) => selectedTaskIdsByClient.get(uuid)?.includes(compactTask.id)),
      target: "",
      weight: compactTask.id,
    };
    unavailableTaskIds.delete(task.id);
    tasksById.set(task.id, task);
    const taskItems = new Map<string, PingOverviewItem>();
    for (const uuid of normalizedUuids) {
      if (!selectedTaskIdsByClient.get(uuid)?.includes(task.id)) continue;
      const stat = overview.stats[uuid]?.[String(task.id)];
      const overviewPoints = overview.series?.[uuid]?.[String(task.id)] ?? [];
      const samples = overviewPoints.flatMap((point) => {
        const timestamp = toPingRecordTimestamp(point.time);
        if (timestamp <= 0) return [];
        // A rollup may contain both successful probes and packet loss. Keep
        // them in one weighted sample: the latency bar remains meaningful,
        // while the quality bar and tooltip retain the exact loss ratio.
        if (!isValidPingLatency(point.value) && point.loss_count <= 0) return [];
        return [{
          time: timestamp,
          value: isValidPingLatency(point.value) ? point.value : -1,
          sampleCount: Math.max(1, point.sample_count),
          lossCount: Math.max(0, Math.min(point.sample_count, point.loss_count)),
        }];
      });
      const values = overviewPoints.map((point) => point.value).filter(isValidPingLatency);
      const validLatest = stat && isValidPingLatency(stat.latest) ? stat.latest : (values.at(-1) ?? null);
      taskItems.set(uuid, {
        client: uuid,
        isAssigned: true,
        lastValue: validLatest,
        values,
        samples,
        max: Math.max(1, stat?.max ?? 0, ...values),
        loss: stat?.loss ?? null,
        taskIds: [task.id],
        taskCount: 1,
        taskSummaries: [],
      });
    }
    itemsByTask.set(task.id, taskItems);
    refreshIntervals.push(normalizeRefreshInterval(task.interval));
  }

  const items = new Map<string, PingOverviewItem>();
  for (const [uuid, taskIds] of selectedTaskIdsByClient) {
    const activeTaskIds = taskIds.filter((taskId) => !unavailableTaskIds.has(taskId));
    if (activeTaskIds.length === 0) continue;
    const item = aggregateHomepagePingOverviewItem({
      client: uuid,
      taskIds: activeTaskIds,
      itemsByTask,
      tasksById,
      aggregationStrategy,
      primaryTaskId: primaryTasks[uuid] ?? null,
    });
    items.set(uuid, item);
  }

  return {
    assignmentKey: buildHomepagePingAssignmentKey(
      new Map(
        Array.from(selectedTaskIdsByClient)
          .map(([uuid, taskIds]) => [
            uuid,
            taskIds.filter((taskId) => !unavailableTaskIds.has(taskId)),
          ] as const)
          .filter(([, taskIds]) => taskIds.length > 0),
      ),
    ),
    intervalMs:
      refreshIntervals.length > 0
        ? Math.min(...refreshIntervals)
        : DEFAULT_PING_REFRESH_INTERVAL,
    items,
  };
}

interface PingOverviewStoreState {
  assignmentKey: string;
  intervalMs: number;
  items: Map<string, PingOverviewStoreEntry>;
}

let pingOverviewState: PingOverviewStoreState = {
  assignmentKey: "",
  intervalMs: DEFAULT_PING_REFRESH_INTERVAL,
  items: new Map(),
};
let scheduledVisibleUuids: string[] = [];
let scheduledVisibleKey = "";
let scheduledBindings: HomepagePingTaskBindings = {};
let scheduledBindingsKey = stringifyBindings({});
let scheduledAggregationStrategy: HomepagePingAggregationStrategy =
  DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY;
let scheduledPrimaryTasks: HomepagePingPrimaryTasks = {};
let scheduledPrimaryTasksKey = stringifyPrimaryTasks({});
let pingRefreshInFlight = false;
let pingRefreshTimer: number | null = null;
let pingAbortController: AbortController | null = null;
let activeConsumers = 0;
const pingListeners = new Map<string, Set<Listener>>();

function schedulePingRefresh(intervalMs: number) {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // 没有组件消费 overview 时就停止轮询。等有消费者再次挂载时，
  // 由 ensurePingOverviewStarted 重新启动整条链路。
  if (activeConsumers <= 0) return;
  pingRefreshTimer = window.setTimeout(() => {
    pingRefreshTimer = null;
    void refreshPingOverview();
  }, intervalMs);
}

function stopPingPolling() {
  if (pingRefreshTimer != null) {
    window.clearTimeout(pingRefreshTimer);
    pingRefreshTimer = null;
  }
  // 中止进行中的 refresh（如果有），让它的请求和带宽在 teardown 时立刻释放；
  // refreshPingOverview 会把已 abort 的 signal 当成非当前，跳过 commit/重新调度。
  if (pingAbortController) {
    pingAbortController.abort();
    pingAbortController = null;
  }
}

function commitPingOverview(
  assignmentKey: string,
  intervalMs: number,
  items: Map<string, PingOverviewItem>,
) {
  const prevItems = pingOverviewState.items;
  const nextItems = new Map<string, PingOverviewStoreEntry>();
  const touched = new Set<string>();
  // 记账字段（missingRounds）变了但没有可见变化。仍然必须持久化新状态，
  // 这样 grace 计数才能最终淘汰掉消失的 client；否则下面的提前 return 会丢掉这次
  // 自增，该 item 就会被永远保留。
  let bookkeepingChanged = false;
  const keys = new Set<string>([...prevItems.keys(), ...items.keys()]);
  const preserveMissing = pingOverviewState.assignmentKey === assignmentKey;

  for (const key of keys) {
    const prevEntry = prevItems.get(key);
    const prev = prevEntry?.item;
    const next = items.get(key);

    if (!next) {
      if (
        preserveMissing &&
        prevEntry &&
        prevEntry.missingRounds < PING_OVERVIEW_MISSING_GRACE_ROUNDS
      ) {
        nextItems.set(key, {
          ...prevEntry,
          missingRounds: prevEntry.missingRounds + 1,
        });
        bookkeepingChanged = true;
        continue;
      }
      if (prevEntry) touched.add(key);
      continue;
    }

    if (equalPingItem(prev, next)) {
      nextItems.set(key, {
        item: prev ?? next,
        missingRounds: 0,
      });
      continue;
    }

    nextItems.set(key, {
      item: next,
      missingRounds: 0,
    });
    touched.add(key);
  }

  if (
    pingOverviewState.assignmentKey === assignmentKey &&
    pingOverviewState.intervalMs === intervalMs &&
    touched.size === 0 &&
    nextItems.size === prevItems.size &&
    !bookkeepingChanged
  ) {
    return;
  }

  pingOverviewState = {
    assignmentKey,
    intervalMs,
    items: nextItems,
  };

  for (const key of touched) {
    const listeners = pingListeners.get(key);
    if (!listeners) continue;
    for (const listener of listeners) listener();
  }
}

async function refreshPingOverview() {
  if (pingRefreshInFlight) return;

  pingRefreshInFlight = true;
  const visibleKey = scheduledVisibleKey;
  const bindingsKey = scheduledBindingsKey;
  const aggregationStrategy = scheduledAggregationStrategy;
  const primaryTasks = scheduledPrimaryTasks;
  const primaryTasksKey = scheduledPrimaryTasksKey;
  const controller = new AbortController();
  pingAbortController = controller;
  const { signal } = controller;
  // 判断当前请求是否仍然有效（没被 stopPingPolling 中止，
  // 且 visible/binding 分配在执行期间没有被改掉）。
  const isCurrent = () =>
    !signal.aborted &&
    visibleKey === scheduledVisibleKey &&
    bindingsKey === scheduledBindingsKey &&
    aggregationStrategy === scheduledAggregationStrategy &&
    primaryTasksKey === scheduledPrimaryTasksKey;

  try {
    if (scheduledVisibleUuids.length === 0) {
      commitPingOverview("", DEFAULT_PING_REFRESH_INTERVAL, new Map());
      return;
    }

    const next = await buildHomepagePingOverviewMap(
      HOMEPAGE_PING_WINDOW_HOURS,
      scheduledVisibleUuids,
      scheduledBindings,
      aggregationStrategy,
      primaryTasks,
      signal,
    );
    if (isCurrent()) {
      commitPingOverview(next.assignmentKey, next.intervalMs, next.items);
      schedulePingRefresh(next.intervalMs);
    }
  } catch {
    if (isCurrent()) {
      schedulePingRefresh(DEFAULT_PING_REFRESH_INTERVAL);
    }
  } finally {
    pingRefreshInFlight = false;
    if (pingAbortController === controller) pingAbortController = null;
    // 只要消费者还想轮询但队列里没有任务，就恢复轮询。这覆盖了执行中途 assignment
    // 变化（上面那次跑会跳过 commit）以及 abort/重新挂载竞态（如 StrictMode:
    // mount→stop(abort)→mount），后者里被 abort 的那次不能负责重新调度。成功或失败
    // 的一次已经设过 timer，所以稳态下这里是 no-op。
    if (
      activeConsumers > 0 &&
      scheduledVisibleUuids.length > 0 &&
      pingRefreshTimer == null
    ) {
      void refreshPingOverview();
    }
  }
}

function ensurePingOverviewStarted(
  visibleUuids: string[],
  bindings: HomepagePingTaskBindings,
  aggregationStrategy: HomepagePingAggregationStrategy,
  primaryTasks: HomepagePingPrimaryTasks,
) {
  const normalizedVisibleUuids = normalizeVisibleUuids(visibleUuids);
  const visibleKey = normalizedVisibleUuids.join("|");
  const bindingsKey = stringifyBindings(bindings);
  const primaryTasksKey = stringifyPrimaryTasks(primaryTasks);

  if (
    scheduledVisibleKey !== visibleKey ||
    scheduledBindingsKey !== bindingsKey ||
    scheduledAggregationStrategy !== aggregationStrategy ||
    scheduledPrimaryTasksKey !== primaryTasksKey
  ) {
    scheduledVisibleUuids = normalizedVisibleUuids;
    scheduledVisibleKey = visibleKey;
    scheduledBindings = bindings;
    scheduledBindingsKey = bindingsKey;
    scheduledAggregationStrategy = aggregationStrategy;
    scheduledPrimaryTasks = primaryTasks;
    scheduledPrimaryTasksKey = primaryTasksKey;

    if (pingRefreshTimer != null) {
      window.clearTimeout(pingRefreshTimer);
      pingRefreshTimer = null;
    }
    void refreshPingOverview();
    return;
  }

  // 只要没有待处理请求、也没有已调度的 tick 就重启——这同时覆盖首次挂载
  // 和轮询被停止后的恢复。
  if (
    normalizedVisibleUuids.length > 0 &&
    !pingRefreshInFlight &&
    pingRefreshTimer == null
  ) {
    void refreshPingOverview();
  }
}

function subscribeToPingItem(uuid: string, listener: Listener) {
  let listeners = pingListeners.get(uuid);
  if (!listeners) {
    listeners = new Set();
    pingListeners.set(uuid, listeners);
  }
  listeners.add(listener);

  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      pingListeners.delete(uuid);
    }
  };
}

function getPingSnapshot(uuid: string) {
  return pingOverviewState.items.get(uuid)?.item ?? EMPTY_PING;
}

let pingMapSnapshotCacheKey = "";
let pingMapSnapshotCache = new Map<string, PingOverviewItem>();

function pingItemSignature(item: PingOverviewItem) {
  const lastSample = item.samples[item.samples.length - 1];
  const taskIds = item.taskIds ?? [];
  const taskSummaries = item.taskSummaries ?? [];
  return [
    item.client,
    item.isAssigned ? "1" : "0",
    item.lastValue ?? "",
    item.loss ?? "",
    item.aggregationStrategy ?? DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY,
    item.primaryTaskId ?? "",
    item.taskCount ?? 0,
    taskIds.join("/"),
    taskSummaries
      .map((summary) =>
        [
          summary.taskId,
          summary.name,
          summary.target,
          summary.lastValue ?? "",
          summary.loss ?? "",
          summary.sampleCount,
          summary.hasSamples ? "1" : "0",
          summary.samples?.length ?? 0,
          summary.samples?.at(-1)?.time ?? "",
          summary.samples?.at(-1)?.value ?? "",
          summary.samples?.at(-1)?.sampleCount ?? "",
          summary.samples?.at(-1)?.lossCount ?? "",
        ].join(":"),
      )
      .join(";"),
    item.values.length,
    lastSample?.time ?? "",
    lastSample?.value ?? "",
    lastSample?.sampleCount ?? "",
    lastSample?.lossCount ?? "",
  ].join(",");
}

function getPingMapSnapshot(uuids: string[]) {
  const key = uuids.map((uuid) => `${uuid}:${pingItemSignature(getPingSnapshot(uuid))}`).join("|");
  if (key === pingMapSnapshotCacheKey) return pingMapSnapshotCache;

  pingMapSnapshotCacheKey = key;
  pingMapSnapshotCache = new Map(uuids.map((uuid) => [uuid, getPingSnapshot(uuid)]));
  return pingMapSnapshotCache;
}

function subscribeToPingItems(uuids: string[], listener: Listener) {
  const unsubscribes = uuids.map((uuid) => subscribeToPingItem(uuid, listener));
  return () => {
    unsubscribes.forEach((unsubscribe) => unsubscribe());
  };
}

export function useHomepagePingOverview() {
  const { data: me } = useAuth();
  const visibleUuids = useVisibleNodeUuids(me?.logged_in === true);
  const themeSettings = useThemeSettings();

  useEffect(() => {
    if (!themeSettings.isReady) return;
    activeConsumers += 1;
    ensurePingOverviewStarted(
      visibleUuids,
      themeSettings.homepagePingBindings,
      themeSettings.homepagePingAggregationStrategy,
      themeSettings.homepagePingPrimaryTasks,
    );
    return () => {
      activeConsumers -= 1;
      if (activeConsumers <= 0) {
        activeConsumers = 0;
        stopPingPolling();
      }
    };
  }, [
    themeSettings.homepagePingAggregationStrategy,
    themeSettings.homepagePingBindings,
    themeSettings.homepagePingPrimaryTasks,
    themeSettings.isReady,
    visibleUuids,
  ]);
}

export function usePingMini(uuid: string): PingOverviewItem {
  const subscribe = useCallback(
    (cb: Listener) => (uuid ? subscribeToPingItem(uuid, cb) : () => undefined),
    [uuid],
  );
  const getSnapshot = useCallback(
    () => (uuid ? getPingSnapshot(uuid) : EMPTY_PING),
    [uuid],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePingMiniMap(uuids: string[]): Map<string, PingOverviewItem> {
  const uuidsKey = useMemo(
    () => normalizeVisibleUuids(uuids).join("|"),
    [uuids],
  );
  const normalizedUuids = useMemo(
    () => (uuidsKey ? uuidsKey.split("|") : []),
    [uuidsKey],
  );
  const subscribe = useCallback(
    (cb: Listener) => subscribeToPingItems(normalizedUuids, cb),
    [normalizedUuids],
  );
  const getSnapshot = useCallback(
    () => getPingMapSnapshot(normalizedUuids),
    [normalizedUuids],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function buildPingOverviewBuckets(
  samples: PingOverviewSample[] | undefined,
  count?: number,
  now = Date.now(),
): PingOverviewBucket[] {
  const totalWindowMs = 60 * 60 * 1000;
  const resolvedCount = count ?? MAX_VISIBLE_HOMEPAGE_PING_BUCKETS;
  const bucketMs = totalWindowMs / resolvedCount;
  const windowStart = now - bucketMs * resolvedCount;
  const totals = new Array<number>(resolvedCount).fill(0);
  const losts = new Array<number>(resolvedCount).fill(0);
  const positiveSums = new Array<number>(resolvedCount).fill(0);
  const positiveCounts = new Array<number>(resolvedCount).fill(0);

  for (const sample of samples ?? []) {
    if (sample.time < windowStart || sample.time > now) continue;

    let bucketIndex = Math.floor((sample.time - windowStart) / bucketMs);
    if (bucketIndex < 0) continue;
    if (bucketIndex >= resolvedCount) bucketIndex = resolvedCount - 1;

    const total = Number.isFinite(sample.sampleCount) && sample.sampleCount != null
      ? Math.max(1, Math.round(sample.sampleCount))
      : 1;
    const lost = Number.isFinite(sample.lossCount) && sample.lossCount != null
      ? Math.max(0, Math.min(total, Math.round(sample.lossCount)))
      : isValidPingLatency(sample.value) ? 0 : total;
    const valid = Math.max(0, total - lost);
    totals[bucketIndex] += total;
    losts[bucketIndex] += lost;
    if (isValidPingLatency(sample.value) && valid > 0) {
      positiveSums[bucketIndex] += sample.value * valid;
      positiveCounts[bucketIndex] += valid;
    }
  }

  return Array.from({ length: resolvedCount }, (_, index) => {
    const startAt = windowStart + index * bucketMs;
    const endAt = startAt + bucketMs;
    const total = totals[index];
    const lost = losts[index];
    const positiveCount = positiveCounts[index];

    return {
      index,
      value: positiveCount > 0 ? positiveSums[index] / positiveCount : null,
      loss: total > 0 ? (lost / total) * 100 : null,
      total,
      lost,
      startAt,
      endAt,
    };
  });
}

export function usePingMiniBuckets(
  ping: Pick<PingOverviewItem, "samples">,
  count?: number,
): PingOverviewBucket[] {
  return useMemo(
    () => buildPingOverviewBuckets(ping.samples, count),
    [count, ping.samples],
  );
}
