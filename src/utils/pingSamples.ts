import type { PingRecord } from "@/types/komari";

/**
 * Ping samples only have a usable RTT when the probe receives a reply.
 * Komari's historical records use non-positive values as timeout/loss sentinels,
 * so zero is not a valid latency sample here.
 */
export function isValidPingLatency(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isLostPingSample(value: unknown): boolean {
  return !isValidPingLatency(value);
}

/**
 * A historical record can be a single probe or a server-side rollup. Preserve
 * rollup weights so every page derives loss and latency from the same sample
 * population instead of treating heterogeneous buckets as equal observations.
 */
export function getPingRecordSampleCounts(
  record: Pick<PingRecord, "value" | "sample_count" | "loss_count">,
) {
  const total = Number.isFinite(record.sample_count) && record.sample_count != null
    ? Math.max(1, Math.round(record.sample_count))
    : 1;
  const explicitLost = Number.isFinite(record.loss_count) && record.loss_count != null
    ? Math.max(0, Math.min(total, Math.round(record.loss_count)))
    : null;
  const lost = explicitLost ?? (isLostPingSample(record.value) ? total : 0);

  return {
    total,
    lost,
    valid: Math.max(0, total - lost),
  };
}
