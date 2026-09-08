import { useQuery } from "@tanstack/react-query";
import { getLoadRecords, getPingRecords } from "@/services/api";
import type { NodeInfo } from "@/types/komari";
import type { PingTimeRange } from "@/utils/pingTimeRange";

export function useLoadRecords(
  uuid: string,
  hours = 6,
  enabled = true,
  node?: NodeInfo,
) {
  return useQuery({
    // Official Komari exposes used values in its metric store but not the
    // historical capacity denominator. Include the stable node capacities in
    // the cache identity so a chart that mounts before metadata hydration is
    // automatically refreshed once those percentages become available.
    queryKey: [
      "records",
      "load",
      uuid,
      hours,
      node?.mem_total ?? 0,
      node?.swap_total ?? 0,
      node?.disk_total ?? 0,
    ],
    queryFn: () => getLoadRecords(uuid, hours, node),
    staleTime: 300_000,
    // 关掉后台自动重拉（聚焦/切标签页的 refetch 会让 uplot-react 重建图表、偶发闪空白）；有手动刷新兜底。
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(uuid) && enabled,
  });
}

export function usePingRecords(uuid: string, hours = 6, enabled = true, range?: PingTimeRange) {
  return useQuery({
    queryKey: ["records", "ping", uuid, hours, range?.start, range?.end],
    queryFn: () => getPingRecords(uuid, hours, range),
    staleTime: 300_000,
    // 关掉后台自动重拉（聚焦/切标签页的 refetch 会让 uplot-react 重建图表、偶发闪空白）；有手动刷新兜底。
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    enabled: Boolean(uuid) && enabled,
  });
}
