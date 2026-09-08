import type { PingOverviewItem, PingOverviewTaskSummary } from "@/types/komari";
import { formatLatency, formatLatencyValue, formatMetricNumber, formatPacketLoss } from "@/utils/format";
import {
  HOMEPAGE_PING_WINDOW_HOURS,
  HOMEPAGE_PING_WINDOW_LABEL,
} from "@/utils/homepagePingOverview";
import type { HomepagePingTaskGroups } from "@/utils/homepagePingSettings";

export interface HomepagePingSourceRow {
  taskId: number;
  name: string;
  group: string;
  target: string;
  latencyMs: number | null;
  lossPercent: number | null;
  latencyLabel: string;
  latencyShortLabel: string;
  lossLabel: string;
  lossShortLabel: string;
  latencyRatio: number;
  lossDotCount: number;
  samples: Array<{ time: number; value: number }>;
  attentionScore: number;
  title: string;
  status: "ok" | "warning" | "critical" | "empty";
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function sourceStatus(summary: PingOverviewTaskSummary): HomepagePingSourceRow["status"] {
  if (!summary.hasSamples) return "empty";
  if ((summary.loss ?? 0) >= 20 || (summary.lastValue ?? 0) >= 1000) return "critical";
  if ((summary.loss ?? 0) >= 5 || (summary.lastValue ?? 0) >= 300) return "warning";
  return "ok";
}

function sourceAttentionScore(summary: PingOverviewTaskSummary) {
  const status = sourceStatus(summary);
  const base = status === "critical" ? 3000 : status === "warning" ? 2000 : status === "empty" ? 1000 : 0;
  const loss = summary.loss != null ? summary.loss * 12 : 0;
  const latency = summary.lastValue != null ? Math.min(summary.lastValue, 2000) / 10 : 0;
  return base + loss + latency;
}

function latencyRatio(value: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  if (value <= 150) return clamp01(value / 220);
  if (value <= 300) return clamp01(0.68 + ((value - 150) / 150) * 0.18);
  return clamp01(0.86 + Math.min(value - 300, 700) / 700 * 0.14);
}

function lossDotCount(value: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) return 0;
  if (value <= 1) return 1;
  if (value <= 3) return 2;
  if (value <= 5) return 3;
  if (value <= 10) return 4;
  return 5;
}

function latencyLabel(value: number | null) {
  return value != null ? formatLatency(value) : "无有效延迟";
}

function latencyShortLabel(value: number | null) {
  return value != null ? formatLatencyValue(value) : "—";
}

function lossLabel(value: number | null) {
  return value != null ? formatPacketLoss(value) : "未知";
}

function lossShortLabel(value: number | null) {
  return value != null ? formatMetricNumber(value) : "—";
}

function sourceTitle(row: {
  name: string;
  group: string;
  target: string;
  taskId: number;
  latencyLabel: string;
  lossLabel: string;
  status: HomepagePingSourceRow["status"];
}) {
  const meta = [row.group, row.target || `ID ${row.taskId}`].filter(Boolean).join(" / ");
  const status =
    row.status === "critical"
      ? "严重"
      : row.status === "warning"
        ? "需关注"
        : row.status === "empty"
          ? "暂无样本"
          : "正常";
  return `${row.name}${meta ? ` · ${meta}` : ""} · ${row.latencyLabel} · ${HOMEPAGE_PING_WINDOW_LABEL}丢包 ${row.lossLabel} · ${status}`;
}

export function buildHomepagePingSourceRows(
  ping: Pick<PingOverviewItem, "taskSummaries">,
  taskGroups: HomepagePingTaskGroups = {},
  taskOrder: number[] = [],
): HomepagePingSourceRow[] {
  return (ping.taskSummaries ?? [])
    .map((summary, index) => {
      const group = taskGroups[String(summary.taskId)] ?? "";
      const status = sourceStatus(summary);
      const latencyText = latencyLabel(summary.lastValue);
      const lossText = lossLabel(summary.loss);
      const row: HomepagePingSourceRow = {
        taskId: summary.taskId,
        name: summary.name,
        group,
        target: summary.target,
        latencyMs: summary.lastValue,
        lossPercent: summary.loss,
        latencyLabel: latencyText,
        latencyShortLabel: latencyShortLabel(summary.lastValue),
        lossLabel: lossText,
        lossShortLabel: lossShortLabel(summary.loss),
        latencyRatio: latencyRatio(summary.lastValue),
        lossDotCount: lossDotCount(summary.loss),
        samples: summary.samples ?? [],
        attentionScore: sourceAttentionScore(summary),
        title: sourceTitle({
          name: summary.name,
          group,
          target: summary.target,
          taskId: summary.taskId,
          latencyLabel: latencyText,
          lossLabel: lossText,
          status,
        }),
        status,
      };
      return { row, sourceIndex: index };
    })
    .sort((left, right) => {
      const leftIndex = taskOrder.indexOf(left.row.taskId);
      const rightIndex = taskOrder.indexOf(right.row.taskId);
      const byOrder = (leftIndex < 0 ? taskOrder.length : leftIndex) - (rightIndex < 0 ? taskOrder.length : rightIndex);
      if (byOrder !== 0) return byOrder;
      return left.sourceIndex - right.sourceIndex;
    })
    .map(({ row }) => row);
}

export function buildHomepagePingCompareUrl(uuid: string, taskIds: number[]) {
  const params = new URLSearchParams({
    nodes: uuid,
    metric: "ping_latency",
    hours: String(HOMEPAGE_PING_WINDOW_HOURS),
    tab: "trend",
  });
  const normalizedTaskIds = Array.from(new Set(taskIds))
    .filter((taskId) => Number.isInteger(taskId) && taskId > 0)
    .sort((left, right) => left - right);
  if (normalizedTaskIds.length > 0) {
    params.set("pingTasks", normalizedTaskIds.join(","));
  }
  return `/compare?${params.toString()}`;
}
