import { z } from "zod";

/** Schema 接受服务端发来的宽松/不完整数据,并填充合理默认值。 */

const looseString = z
  .union([z.string(), z.number(), z.boolean()])
  .transform((v) => String(v))
  .catch("");
const looseNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : Number.parseFloat(v) || 0))
  .catch(0);
const looseBool = z
  .union([z.boolean(), z.number(), z.string()])
  .transform((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;

    const normalized = v.trim().toLowerCase();
    if (normalized === "" || normalized === "0" || normalized === "false") {
      return false;
    }
    if (normalized === "1" || normalized === "true") {
      return true;
    }

    return Boolean(normalized);
  })
  .catch(false);
const looseBoolNullable = z
  .union([z.boolean(), z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v == null) return null;
    const parsed = looseBool.safeParse(v);
    return parsed.success ? parsed.data : null;
  })
  .catch(null);

export const NodeInfoSchema = z
  .object({
    uuid: z.string(),
    name: looseString.default(""),
    group: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    region: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    hidden: looseBool.default(false),
    cpu_name: looseString.default(""),
    cpu_cores: looseNumber.default(0),
    arch: looseString.default(""),
    virtualization: looseString.default(""),
    os: looseString.default(""),
    kernel_version: looseString.default(""),
    version: looseString.default(""),
    ipv4: looseString.default(""),
    ipv6: looseString.default(""),
    capability_ping: looseBoolNullable.default(null),
    capability_private_ping_targets: looseBoolNullable.default(null),
    gpu_name: looseString.default(""),
    mem_total: looseNumber.default(0),
    swap_total: looseNumber.default(0),
    disk_total: looseNumber.default(0),
    weight: looseNumber.default(0),
    price: looseNumber.default(0),
    billing_cycle: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    auto_renewal: looseBool.default(false),
    currency: looseString.default(""),
    provider: looseString.default(""),
    business_role: looseString.default(""),
    expired_at: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    tags: looseString.default(""),
    public_remark: looseString.default(""),
    traffic_limit: looseNumber.default(0),
    traffic_limit_type: looseString.default(""),
    created_at: looseString.default(""),
    updated_at: looseString.default(""),
  })
  .passthrough();

export interface NodeInfo {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
  hidden: boolean;
  cpu_name: string;
  cpu_cores: number;
  arch: string;
  virtualization: string;
  os: string;
  kernel_version: string;
  version: string;
  ipv4: string;
  ipv6: string;
  capability_ping: boolean | null;
  capability_private_ping_targets: boolean | null;
  gpu_name: string;
  mem_total: number;
  swap_total: number;
  disk_total: number;
  weight: number;
  price: number;
  billing_cycle?: string | null;
  auto_renewal: boolean;
  currency: string;
  provider?: string | null;
  business_role?: string | null;
  expired_at?: string | null;
  tags: string;
  public_remark: string;
  traffic_limit: number;
  traffic_limit_type: string;
  created_at: string;
  updated_at: string;
}

export interface NodeRealtime {
  cpu: { usage: number };
  ram: { total: number; used: number };
  swap: { total: number; used: number };
  load: { load1: number; load5: number; load15: number };
  disk: { total: number; used: number };
  network: { up: number; down: number; totalUp: number; totalDown: number };
  connections: { tcp: number; udp: number };
  uptime: number;
  process: number;
  updated_at?: string | number;
}

/** 展示用模型:扁平化的节点信息 + 实时指标 + 在线标志。 */
export interface NodeMetrics {
  online: boolean | null;
  cpuPct: number;
  ramUsed: number;
  ramTotal: number;
  ramPct: number;
  swapUsed: number;
  swapTotal: number;
  swapPct: number;
  diskUsed: number;
  diskTotal: number;
  diskPct: number;
  netUp: number;
  netDown: number;
  trafficUp: number;
  trafficDown: number;
  uptime: number;
  load1: number;
  load5: number;
  load15: number;
  process: number;
  connectionsTcp: number;
  connectionsUdp: number;
  updatedAt: number;
}

export interface ThemeSettings {
  defaultAppearance?: "system" | "light" | "dark";
  displayTimeZone?: string;
  desktopNodeViewMode?: "large" | "compact" | "list";
  mobileNodeViewMode?: "large" | "compact" | "list";
  enableAdminButton?: boolean;
  showPingChart?: boolean;
  homepagePingBindings?: Record<string, string[]>;
  homepagePingTaskOrder?: Record<string, number[]>;
  homepagePingAggregationStrategy?: "worst" | "primary" | "average";
  homepagePingPrimaryTasks?: Record<string, number>;
  homepagePingTaskGroups?: Record<string, string>;
  showHomeOverview?: boolean;
  showGroupTabs?: boolean;
  homeGroupOrder?: string[];
  homeFacetDimensions?: unknown[];
  homeNodeFacets?: Record<string, Record<string, unknown>>;
  homeDefaultFacetDimension?: string;
  homeSelectedNodeUuids?: string[] | string;
  homeSavedViews?: unknown[];
  homeDefaultSavedViewId?: string;
  moveOfflineNodesBack?: boolean;
  showCostSummary?: boolean;
  showCostSummaryFloatingButton?: boolean;
  showOverviewRatings?: boolean;
  overviewRatingStyle?: "plain" | "cultivation";
  showTrafficRating?: boolean;
  showBandwidthRating?: boolean;
  showAssetRating?: boolean;
  trafficRatingLabels?: string;
  bandwidthRatingLabels?: string;
  assetRatingLabels?: string;
  compactShowTrafficTotal?: boolean;
  compactShowBilling?: boolean;
  compactShowUptime?: boolean;
  showConnections?: boolean;
  costIgnoredNodes?: string[];
  costRateApiUrl?: string;
  backgroundImage?: string;
  backgroundImageMobile?: string;
  backgroundAlignment?: string;
  surfaceOpacity?: number;
}

export const PublicConfigSchema = z
  .object({
    sitename: z.string().default(""),
    description: z.string().default(""),
    theme: z.string().default(""),
    allow_cors: z.boolean().default(false),
    disable_password_login: z.boolean().default(false),
    oauth_enable: z.boolean().default(false),
    private_site: z.boolean().default(false),
    record_enabled: z.boolean().default(true),
    record_preserve_time: z.number().default(0),
    ping_record_preserve_time: z.number().default(0),
    custom_head: z.string().default(""),
    custom_body: z.string().default(""),
    theme_settings: z.record(z.string(), z.unknown()).default({}),
  })
  .passthrough();

export interface PublicConfig {
  sitename: string;
  description: string;
  theme: string;
  allow_cors: boolean;
  disable_password_login: boolean;
  oauth_enable: boolean;
  private_site: boolean;
  record_enabled: boolean;
  record_preserve_time: number;
  ping_record_preserve_time: number;
  custom_head: string;
  custom_body: string;
  theme_settings: ThemeSettings & Record<string, unknown>;
}

export const AdminClientSchema = z
  .object({
    uuid: z.string(),
    name: looseString.default(""),
    group: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    region: z.union([z.string(), z.number()]).nullish().transform((v) => (v == null ? "" : String(v))),
    weight: looseNumber.default(0),
    provider: looseString.default(""),
    business_role: looseString.default(""),
    tags: looseString.default(""),
    remark: looseString.default(""),
    public_remark: looseString.default(""),
    version: looseString.default(""),
    ipv4: looseString.default(""),
    ipv6: looseString.default(""),
    capability_ping: looseBoolNullable.default(null),
    capability_private_ping_targets: looseBoolNullable.default(null),
  })
  .passthrough();

export interface AdminClient {
  uuid: string;
  name: string;
  group?: string | null;
  region?: string | null;
  weight: number;
  provider?: string | null;
  business_role?: string | null;
  tags?: string | null;
  remark?: string | null;
  public_remark?: string | null;
  version: string;
  ipv4: string;
  ipv6: string;
  capability_ping: boolean | null;
  capability_private_ping_targets: boolean | null;
}

export const MeSchema = z
  .object({
    logged_in: z.boolean().default(false),
    username: z.string().default(""),
    uuid: z.string().default(""),
  })
  .passthrough();

export interface Me {
  logged_in: boolean;
  username: string;
  uuid: string;
}

export const LoadRecordSchema = z
  .object({
    cpu: z.number().default(0),
    gpu: z.number().default(0),
    ram: z.number().default(0),
    ram_total: z.number().default(0),
    swap: z.number().default(0),
    swap_total: z.number().default(0),
    load: z.number().default(0),
    temp: z.number().default(0),
    disk: z.number().default(0),
    disk_total: z.number().default(0),
    net_in: z.number().default(0),
    net_out: z.number().default(0),
    net_total_up: z.number().default(0),
    net_total_down: z.number().default(0),
    process: z.number().default(0),
    connections: z.number().default(0),
    connections_udp: z.number().default(0),
    time: z.union([z.string(), z.number()]),
    client: z.string().default(""),
  })
  .passthrough();

export interface LoadRecord {
  cpu: number;
  gpu: number;
  ram: number;
  ram_total: number;
  swap: number;
  swap_total: number;
  load: number;
  temp: number;
  disk: number;
  disk_total: number;
  net_in: number;
  net_out: number;
  net_total_up: number;
  net_total_down: number;
  process: number;
  connections: number;
  connections_udp: number;
  time: string | number;
  client: string;
}

export const PingRecordSchema = z
  .object({
    task_id: z.number(),
    time: z.union([z.string(), z.number()]),
    value: z.number(),
    client: z.string().default(""),
    // Metric rollups can represent many probe results in one point.  Keep the
    // weights so comparison charts do not turn a 20% loss bucket into 0% or
    // 100% merely because it is rendered as one normalized record.
    sample_count: z.number().finite().positive().optional(),
    loss_count: z.number().finite().nonnegative().optional(),
    loss_rate: z.number().finite().min(0).max(1).optional(),
  })
  .passthrough();

export interface PingRecord {
  task_id: number;
  time: string | number;
  value: number;
  client: string;
  sample_count?: number;
  loss_count?: number;
  loss_rate?: number;
}

export const PingTaskSchema = z
  .object({
    id: z.number(),
    interval: z.number().default(60),
    name: z.string().default(""),
    loss: z.number().default(0),
    clients: z.array(z.string()).default([]),
    type: z.string().default("icmp"),
    target: z.string().default(""),
    weight: z.number().default(0),
  })
  .passthrough();

export interface PingTask {
  id: number;
  interval: number;
  name: string;
  loss: number;
  clients: string[];
  type: string;
  target: string;
  weight: number;
}

export interface LoadRecordsResponse {
  count: number;
  records: LoadRecord[];
}

export interface PingRecordsResponse {
  count: number;
  records: PingRecord[];
  tasks: PingTask[];
}

export const PingBasicInfoSchema = z
  .object({
    client: z.string().default(""),
    loss: z.number().default(0),
    min: z.number().default(0),
    max: z.number().default(0),
  })
  .passthrough();

export interface PingBasicInfo {
  client: string;
  loss: number;
  min: number;
  max: number;
}

export interface PingOverviewTaskSummary {
  taskId: number;
  name: string;
  target: string;
  lastValue: number | null;
  loss: number | null;
  sampleCount: number;
  hasSamples: boolean;
  samples?: PingOverviewSample[];
}

export interface PingOverviewSample {
  time: number;
  value: number;
  /** Number of probe attempts represented by a downsampled point. */
  sampleCount?: number;
  /** Number of lost attempts in the same downsampled point. */
  lossCount?: number;
}

export interface PingOverviewItem {
  client: string;
  isAssigned: boolean;
  lastValue: number | null;
  values: number[];
  samples: PingOverviewSample[];
  max: number;
  loss: number | null;
  taskIds?: number[];
  taskCount?: number;
  taskSummaries?: PingOverviewTaskSummary[];
  aggregationStrategy?: "worst" | "primary" | "average";
  primaryTaskId?: number | null;
}

export interface TrafficTrendSample {
  value: number;
  level: number;
  opacity: number;
}

export interface PingOverviewBucket {
  index: number;
  value: number | null;
  loss: number | null;
  total: number;
  lost: number;
  startAt: number | null;
  endAt: number | null;
}
