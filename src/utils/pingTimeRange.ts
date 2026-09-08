export interface PingTimeRange { start: string; end: string }

/** datetime-local inputs here always represent Beijing time, regardless of browser timezone. */
export function previousBeijingEvening(now = new Date()): PingTimeRange {
  const beijing = new Date(now.getTime() + 8 * 3_600_000);
  const midnight = Date.UTC(beijing.getUTCFullYear(), beijing.getUTCMonth(), beijing.getUTCDate());
  return {
    start: new Date(midnight - 6 * 3_600_000).toISOString().slice(0, 16),
    end: new Date(midnight).toISOString().slice(0, 16),
  };
}

export function resolveBeijingRange(value: PingTimeRange) {
  const start = new Date(`${value.start}+08:00`);
  const end = new Date(`${value.end}+08:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}
