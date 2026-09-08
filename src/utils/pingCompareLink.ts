export type PingTaskCompareMetricKey = "ping_latency" | "ping_loss";

export interface PingTaskVpsCompareUrlInput {
  taskId: number | null | undefined;
  nodes?: string[];
  metricKey?: PingTaskCompareMetricKey;
  hours?: number;
  view?: "trend" | "ranking";
}

function normalizePingTaskId(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Build a focused Compare route without loading the analysis implementation. */
export function buildPingTaskVpsCompareUrl({
  taskId,
  nodes = [],
  metricKey = "ping_latency",
  hours = 4,
  view = "trend",
}: PingTaskVpsCompareUrlInput) {
  const params = new URLSearchParams({
    metric: metricKey,
    hours: String(hours),
    tab: view,
  });
  const uniqueNodes = Array.from(new Set(nodes.map((node) => node.trim()).filter(Boolean)));
  if (uniqueNodes.length > 0) params.set("nodes", uniqueNodes.join(","));
  const normalizedTaskId = normalizePingTaskId(taskId);
  if (normalizedTaskId != null) params.set("pingTask", String(normalizedTaskId));
  return `/compare?${params.toString()}`;
}
