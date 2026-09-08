import { describe, expect, it } from "vitest";
import {
  collectRealtimeDeltaTargets,
  resolveFlatConnectionsTcp,
  resolveRealtimeOnline,
  resolveTrafficTotal,
  runOfficialSnapshotFixture,
} from "@/services/wsStore";

// 像 resolveTrafficTotals 每个 tick 那样,把一串原始累计读数喂给 resolver:把上一个显示值
//(store 存在 node metrics 上)往后传。
function drive(readings: number[]): number[] {
  let previous = 0;
  return readings.map((raw) => {
    previous = resolveTrafficTotal(previous, raw);
    return previous;
  });
}

describe("resolveTrafficTotal", () => {
  it("passes the backend counter through unchanged while it climbs", () => {
    expect(drive([10, 20, 30])).toEqual([10, 20, 30]);
  });

  it("holds the previous value when a tick reports zero (missing/partial sample)", () => {
    // 读到 0 是 offline/heartbeat 帧或漏了 net_total_up/down 的 payload,不是真实流量。
    // 保持上一个值能避免闪烁到 0,也(这正是我们要防的回归)避免真实读数回来时重复抬高总量:
    // 概览以前每次 offline 抖动都会大致翻倍。
    expect(drive([50, 0, 51])).toEqual([50, 50, 51]);
  });

  it("stays stable across repeated zero readings", () => {
    expect(drive([50, 0, 0, 51, 0, 52])).toEqual([50, 50, 50, 51, 51, 52]);
  });

  it("follows a genuine counter reset down (reboot / billing-cycle rollover)", () => {
    // 后端计数器合理下降;我们如实透传,让概览和流量限额条跟随后端而不是停在虚高值。
    expect(drive([50, 5, 6])).toEqual([50, 5, 6]);
  });

  it("ignores a zero gap but still follows a later real reset", () => {
    // 50 → offline(0,保持)→ 重置后带一个小的真实计数回来。
    expect(drive([50, 0, 2, 3])).toEqual([50, 50, 2, 3]);
  });

  it("does not surface a value until a real reading arrives", () => {
    expect(drive([0, 0, 10])).toEqual([0, 0, 10]);
  });
});

describe("resolveFlatConnectionsTcp", () => {
  it("derives TCP as connections − udp (latest-status sends TCP+UDP combined)", () => {
    expect(resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5 })).toBe(7);
  });

  it("prefers an explicit connections_tcp when present", () => {
    expect(
      resolveFlatConnectionsTcp({ connections: 12, connections_udp: 5, connections_tcp: 9 }),
    ).toBe(9);
  });

  it("clamps to 0 when udp exceeds the combined count", () => {
    expect(resolveFlatConnectionsTcp({ connections: 3, connections_udp: 5 })).toBe(0);
  });
});

describe("resolveRealtimeOnline", () => {
  it("honors the explicit online flag in an official flat latest-status record", () => {
    expect(resolveRealtimeOnline({ online: true, cpu: 12 })).toBe(true);
    expect(resolveRealtimeOnline({ online: false, cpu: 12 })).toBe(false);
  });

  it("marks a node missing from an official snapshot as offline", () => {
    expect(resolveRealtimeOnline(undefined)).toBe(false);
    expect(resolveRealtimeOnline(null)).toBe(false);
  });
});

describe("official current-status snapshot reconciliation", () => {
  it("marks omitted nodes offline, retains explicit offline reports, and clears their traffic trends", () => {
    const result = runOfficialSnapshotFixture(
      ["online", "explicit-offline", "omitted"],
      [
        {
          online: {
            online: true,
            cpu: 11,
            ram: 500,
            ram_total: 1_000,
            disk: 600,
            disk_total: 2_000,
            net_in: 80,
            net_out: 40,
            net_total_up: 1_200,
            net_total_down: 2_400,
            time: 1_700_000_000,
          },
          "explicit-offline": {
            online: true,
            cpu: 22,
            net_in: 60,
            net_out: 30,
            net_total_up: 600,
            net_total_down: 900,
            time: 1_700_000_000,
          },
          omitted: {
            online: true,
            cpu: 33,
            net_in: 50,
            net_out: 25,
            net_total_up: 500,
            net_total_down: 750,
            time: 1_700_000_000,
          },
        },
        {
          online: {
            online: true,
            cpu: 12,
            net_in: 90,
            net_out: 45,
            net_total_up: 1_300,
            net_total_down: 2_500,
            time: 1_700_000_015,
          },
          "explicit-offline": {
            online: false,
            // Official Komari keeps the last report on an offline node.
            cpu: 22,
            net_in: 60,
            net_out: 30,
            net_total_up: 600,
            net_total_down: 900,
            time: 1_700_000_000,
          },
        },
      ],
    );

    expect(result.online.metrics).toMatchObject({
      online: true,
      cpuPct: 12,
      trafficUp: 1_300,
      trafficDown: 2_500,
    });
    expect(result["explicit-offline"].metrics).toMatchObject({
      online: false,
      // The retained upstream report remains available for the offline card.
      cpuPct: 22,
      trafficUp: 600,
      trafficDown: 900,
    });
    expect(result.omitted.metrics).toMatchObject({
      online: false,
      // An omitted current-status record keeps prior metrics but cannot remain online.
      cpuPct: 33,
      trafficUp: 500,
      trafficDown: 750,
    });
    expect(result["explicit-offline"].trends.up.every((point) => point.value === 0)).toBe(true);
    expect(result.omitted.trends.down.every((point) => point.value === 0)).toBe(true);
  });
});

describe("collectRealtimeDeltaTargets", () => {
  it("touches only changed nodes for an incremental delta", () => {
    const result = collectRealtimeDeltaTargets(
      { sequence: 8, snapshot: false, reports: { a: { cpu: 10 } }, offline: ["b"] },
      ["a", "b", "c"],
    );
    expect(result.targets.sort()).toEqual(["a", "b"]);
    expect(result.onlineOverrides.get("b")).toBe(false);
  });

  it("reconciles every known node on snapshots and resyncs", () => {
    const result = collectRealtimeDeltaTargets(
      { sequence: 9, snapshot: true, reports: { a: {} }, online: ["a"] },
      ["a", "b", "c"],
    );
    expect(result.targets).toEqual(["a", "b", "c"]);
    expect(result.onlineOverrides.get("a")).toBe(true);
  });
});
