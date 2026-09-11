import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
	  Globe2,
	  LayoutTemplate,
	  LayoutGrid,
	  List,
	  ListFilter,
	  Moon,
	  Plus,
	  RefreshCw,
	  Rows3,
	  Save,
	  Search,
	  Sun,
	  SunMoon,
	  Tags,
	  Trash2,
	  Wallpaper,
	} from "lucide-react";
import { clsx } from "clsx";
import { InstancePanel } from "@/components/instance/InstancePanel";
import { Spinner } from "@/components/ui/Spinner";
import { usePublicConfig } from "@/hooks/usePublicConfig";
import { queryClient } from "@/services/queryClient";
import {
  ApiRequestError,
  getAdminClients,
  getAdminPingTasks,
  saveThemeSettings,
} from "@/services/api";
import type { AdminClient, PingTask, ThemeSettings } from "@/types/komari";
import {
  type BackgroundPosition,
  type BackgroundSize,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  parseBackgroundAlignment,
} from "@/utils/background";
import {
  isCostRateApiUrlValid,
  normalizeCostIgnoredNodes,
  normalizeCostRateApiUrl,
} from "@/utils/cost";
import {
  dedupeGroupLabels,
  normalizeHomeGroupOrder,
  sortHomeGroupOptions,
} from "@/utils/homeNodes";
import {
  DEFAULT_HOME_FACET_DIMENSIONS,
  HOME_FACET_LEGACY_GROUP,
  buildHomeFacetNode,
  normalizeHomeDefaultFacetDimension,
  normalizeHomeDefaultSavedViewId,
  normalizeHomeFacetDimensions,
  normalizeHomeFacetFilters,
  normalizeHomeFacetId,
  normalizeHomeFacetValues,
  normalizeHomeNodeFacets,
  normalizeHomeSavedViews,
  normalizeHomeSelectedNodeUuids,
  type HomeFacetDimension,
  type HomeFacetFilters,
  type HomeNodeFacets,
  type HomeSavedView,
} from "@/utils/homeVpsViews";
import { buildHomepagePingClientBindingRows } from "@/utils/homepagePingBindingRows";
import {
  filterHomepagePingTaskGroups,
  normalizeHomepagePingPrimaryTasks,
  normalizeHomepagePingTaskGroups,
  type HomepagePingAggregationStrategy,
  type HomepagePingPrimaryTasks,
  type HomepagePingTaskGroups,
} from "@/utils/homepagePingSettings";
import {
  countHomepagePingBindingPairs,
  countHomepagePingBoundClients,
  filterHomepagePingTaskBindings,
  normalizeHomepagePingTaskOrder,
  type HomepagePingTaskOrder,
  normalizeHomepagePingTaskBindings,
  type HomepagePingTaskBindings,
} from "@/utils/pingTasks";
import { HomepagePingEditor } from "@/components/instance/HomepagePingEditor";
import { buildPingDiagnostics } from "@/utils/pingDiagnostics";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
  type Appearance,
  type NodeViewMode,
  type ResolvedThemeSettings,
} from "@/utils/themeSettings";
import {
  DEFAULT_VPS_LIST_SORTS,
  VPS_LIST_SORT_KEYS,
  VPS_LIST_SORT_LABELS,
  recommendedVpsListSortDirection,
  type VpsListSortCondition,
  type VpsListSortKey,
} from "@/utils/vpsListSort";
import {
  DISPLAY_TIME_ZONE_PRESETS,
  SYSTEM_DISPLAY_TIME_ZONE,
  describeDisplayTimeZone,
  formatDisplayDateTime,
  isValidIanaTimeZone,
  normalizeDisplayTimeZone,
  type DisplayTimeZone,
} from "@/utils/timeDisplay";
import {
  getDefaultOverviewRatingLabelText,
  OVERVIEW_RATING_STYLES,
  type OverviewRatingKind,
  type OverviewRatingStyle,
} from "@/utils/overviewRating";

const APPEARANCE_OPTIONS = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "system", label: "跟随系统", icon: SunMoon },
  { value: "dark", label: "深色", icon: Moon },
] as const;
const DISPLAY_TIME_ZONE_LABELS: Record<string, string> = {
  [SYSTEM_DISPLAY_TIME_ZONE]: "跟随浏览器",
  UTC: "UTC",
  "Asia/Shanghai": "上海",
  "Asia/Tokyo": "东京",
  "America/Los_Angeles": "洛杉矶",
  "America/New_York": "纽约",
  "Europe/London": "伦敦",
};
const NODE_VIEW_MODE_OPTIONS = [
  { value: "large", label: "大卡片", icon: LayoutGrid },
  { value: "compact", label: "小卡片", icon: Rows3 },
  { value: "list", label: "列表", icon: List },
] as const;
const PING_AGGREGATION_OPTIONS: Array<{
  value: HomepagePingAggregationStrategy;
  label: string;
  description: string;
}> = [
  { value: "worst", label: "风险优先", description: "显示最高延迟与最高丢包，适合巡检" },
  { value: "primary", label: "主任务优先", description: "优先显示每台 VPS 指定的主任务" },
  { value: "average", label: "平均视图", description: "显示可用任务的平均延迟与丢包" },
];
const BACKGROUND_SIZE_OPTIONS: Array<{ value: BackgroundSize; label: string }> = [
  { value: "cover", label: "填满" },
  { value: "contain", label: "完整" },
  { value: "auto", label: "原始" },
];
const BACKGROUND_POSITION_OPTIONS: Array<{ value: BackgroundPosition; label: string }> = [
  { value: "top", label: "顶部" },
  { value: "center", label: "居中" },
  { value: "bottom", label: "底部" },
];
const HOME_VIEW_SORT_OPTIONS = [
  { value: "weight", label: "默认排序" },
  { value: "risk", label: "风险优先" },
  { value: "expiry", label: "到期时间" },
  { value: "traffic", label: "流量压力" },
  { value: "completeness", label: "资料缺失" },
  { value: "name", label: "名称" },
];
const DEFAULT_HOME_FACET_IDS = new Set(DEFAULT_HOME_FACET_DIMENSIONS.map((dimension) => dimension.id));

function SavedViewSortEditor({
  viewName,
  sorts,
  onChange,
}: {
  viewName: string;
  sorts: VpsListSortCondition[];
  onChange: (sorts: VpsListSortCondition[]) => void;
}) {
  const addCondition = () => {
    const used = new Set(sorts.map((condition) => condition.key));
    const key = VPS_LIST_SORT_KEYS.find((candidate) => !used.has(candidate));
    if (!key) return;
    onChange([...sorts, { key, direction: recommendedVpsListSortDirection(key) }]);
  };
  const updateCondition = (index: number, patch: Partial<VpsListSortCondition>) => {
    const next = sorts.map((condition, conditionIndex) =>
      conditionIndex === index ? { ...condition, ...patch } : condition,
    );
    if (new Set(next.map((condition) => condition.key)).size !== next.length) return;
    onChange(next);
  };
  const moveCondition = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= sorts.length) return;
    const next = [...sorts];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const removeCondition = (index: number) => {
    const next = sorts.filter((_, conditionIndex) => conditionIndex !== index);
    onChange(next.length > 0 ? next : DEFAULT_VPS_LIST_SORTS.map((item) => ({ ...item })));
  };

  return (
    <div className="mt-3 rounded-[10px] border border-[var(--hairline)] bg-[var(--surface-sunken)] px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-semibold text-[var(--text-primary)]">列表多级排序</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">按编号依次比较；首页列表会恢复这里的完整条件。</div>
        </div>
        <button
          type="button"
          className="theme-manage-button is-compact"
          onClick={addCondition}
          disabled={sorts.length >= VPS_LIST_SORT_KEYS.length}
        >
          <Plus size={12} />
          添加条件
        </button>
      </div>
      <div className="mt-2 grid gap-2">
        {sorts.map((condition, index) => (
          <div key={condition.key} className="grid grid-cols-[24px_minmax(0,1fr)_88px_auto] items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-[7px] bg-[color-mix(in_srgb,var(--progress-cpu)_12%,transparent)] text-[10px] font-bold text-[var(--progress-cpu)]">{index + 1}</span>
            <select
              value={condition.key}
              onChange={(event) => {
                const key = event.target.value as VpsListSortKey;
                updateCondition(index, { key, direction: recommendedVpsListSortDirection(key) });
              }}
              className="surface-inset min-w-0 px-2 py-1.5 text-[11px] outline-none"
              aria-label={`${viewName} 的第 ${index + 1} 个排序字段`}
            >
              {VPS_LIST_SORT_KEYS.map((key) => (
                <option key={key} value={key} disabled={sorts.some((item, itemIndex) => itemIndex !== index && item.key === key)}>
                  {VPS_LIST_SORT_LABELS[key]}
                </option>
              ))}
            </select>
            <select
              value={condition.direction}
              onChange={(event) => updateCondition(index, { direction: event.target.value as "asc" | "desc" })}
              className="surface-inset px-2 py-1.5 text-[11px] outline-none"
              aria-label={`${viewName} 的第 ${index + 1} 个排序方向`}
            >
              <option value="asc">升序</option>
              <option value="desc">降序</option>
            </select>
            <span className="flex items-center gap-1">
              <button type="button" className="theme-manage-button is-compact !min-h-7 !px-2" disabled={index === 0} onClick={() => moveCondition(index, -1)} aria-label={`提高 ${VPS_LIST_SORT_LABELS[condition.key]} 优先级`}><ChevronUp size={12} /></button>
              <button type="button" className="theme-manage-button is-compact !min-h-7 !px-2" disabled={index === sorts.length - 1} onClick={() => moveCondition(index, 1)} aria-label={`降低 ${VPS_LIST_SORT_LABELS[condition.key]} 优先级`}><ChevronDown size={12} /></button>
              <button type="button" className="theme-manage-button is-compact is-danger !min-h-7 !px-2" onClick={() => removeCondition(index)} aria-label={`移除 ${VPS_LIST_SORT_LABELS[condition.key]}`}><Trash2 size={12} /></button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const OVERVIEW_RATING_LABEL_FIELDS: Array<{
  key: OverviewRatingKind;
  title: string;
}> = [
  { key: "traffic", title: "累计流量评级名称" },
  { key: "bandwidth", title: "实时带宽评级名称" },
  { key: "asset", title: "资产评级名称" },
];

function sortTasks(tasks: PingTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    if (left.id !== right.id) return left.id - right.id;
    return left.name.localeCompare(right.name);
  });
}

function sortClients(clients: AdminClient[]) {
  return [...clients].sort((left, right) => {
    if (left.weight !== right.weight) return left.weight - right.weight;
    return left.name.localeCompare(right.name);
  });
}

function pruneBindings(bindings: HomepagePingTaskBindings) {
  const normalized = normalizeHomepagePingTaskBindings(bindings);
  const pruned: HomepagePingTaskBindings = {};

  for (const [taskId, clients] of Object.entries(normalized)) {
    if (clients.length > 0) {
      pruned[taskId] = clients;
    }
  }

  return pruned;
}

function formatFacetValues(values: string[] | undefined) {
  return (values ?? []).join("; ");
}

function formatSavedViewFilters(filters: HomeFacetFilters) {
  return Object.entries(filters)
    .map(([dimensionId, values]) => `${dimensionId}=${formatFacetValues(values)}`)
    .join("\n");
}

function parseSavedViewFilters(text: string) {
  const result: HomeFacetFilters = {};
  for (const line of text.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.search(/[=:：]/);
    if (separatorIndex <= 0) continue;
    const dimensionId = normalizeHomeFacetId(trimmed.slice(0, separatorIndex));
    const values = normalizeHomeFacetValues(trimmed.slice(separatorIndex + 1));
    if (dimensionId && values.length > 0) result[dimensionId] = values;
  }
  return normalizeHomeFacetFilters(result);
}

function clearFacetFilter(filters: HomeFacetFilters, dimensionId: string) {
  const next = { ...filters };
  delete next[dimensionId];
  return next;
}

function createSavedViewId(existing: HomeSavedView[]) {
  const used = new Set(existing.map((view) => view.id));
  for (let index = existing.length + 1; index < existing.length + 100; index += 1) {
    const id = `view${index}`;
    if (!used.has(id)) return id;
  }
  return `view${Date.now().toString(36)}`;
}

function createCustomDimensionId(existing: HomeFacetDimension[]) {
  const used = new Set(existing.map((dimension) => dimension.id));
  for (let index = 1; index < 100; index += 1) {
    const id = `custom${index}`;
    if (!used.has(id)) return id;
  }
  return `custom${Date.now().toString(36)}`;
}

function pickManagedThemeSettings(settings: ResolvedThemeSettings): ThemeSettings {
  return {
    defaultAppearance: settings.defaultAppearance,
    displayTimeZone: settings.displayTimeZone,
    desktopNodeViewMode: settings.desktopNodeViewMode,
    mobileNodeViewMode: settings.mobileNodeViewMode,
    homepagePingBindings: settings.homepagePingBindings,
    homepagePingTaskOrder: settings.homepagePingTaskOrder,
    homepagePingAggregationStrategy: settings.homepagePingAggregationStrategy,
    homepagePingPrimaryTasks: settings.homepagePingPrimaryTasks,
    homepagePingTaskGroups: settings.homepagePingTaskGroups,
    showHomeOverview: settings.showHomeOverview,
    showGroupTabs: settings.showGroupTabs,
    homeGroupOrder: settings.homeGroupOrder,
    homeFacetDimensions: settings.homeFacetDimensions,
    homeNodeFacets: settings.homeNodeFacets,
    homeDefaultFacetDimension: settings.homeDefaultFacetDimension,
    homeSelectedNodeUuids: settings.homeSelectedNodeUuids,
    homeSavedViews: settings.homeSavedViews,
    homeDefaultSavedViewId: settings.homeDefaultSavedViewId,
    moveOfflineNodesBack: settings.moveOfflineNodesBack,
    showCostSummary: settings.showCostSummary,
    showCostSummaryFloatingButton: settings.showCostSummaryFloatingButton,
    showOverviewRatings: settings.showOverviewRatings,
    overviewRatingStyle: settings.overviewRatingStyle,
    showTrafficRating: settings.showTrafficRating,
    showBandwidthRating: settings.showBandwidthRating,
    showAssetRating: settings.showAssetRating,
    trafficRatingLabels: settings.trafficRatingLabels,
    bandwidthRatingLabels: settings.bandwidthRatingLabels,
    assetRatingLabels: settings.assetRatingLabels,
    compactShowTrafficTotal: settings.compactShowTrafficTotal,
    compactShowBilling: settings.compactShowBilling,
    compactShowUptime: settings.compactShowUptime,
    showConnections: settings.showConnections,
    costIgnoredNodes: settings.costIgnoredNodes,
    costRateApiUrl: settings.costRateApiUrl,
    backgroundImage: settings.backgroundImage,
    backgroundImageMobile: settings.backgroundImageMobile,
    backgroundAlignment: settings.backgroundAlignment,
    surfaceOpacity: settings.surfaceOpacity,
  };
}

function managedSettingsSignature(settings: ThemeSettings & Record<string, unknown>) {
  return JSON.stringify(pickManagedThemeSettings(normalizeThemeSettings(settings)));
}

export function ThemeManage() {
  const { data: config, isLoading: configLoading } = usePublicConfig();
  const [draftAppearance, setDraftAppearance] = useState<Appearance>("system");
  const [draftDisplayTimeZoneText, setDraftDisplayTimeZoneText] =
    useState<DisplayTimeZone>(DEFAULT_THEME_SETTINGS.displayTimeZone);
  const [draftDesktopNodeViewMode, setDraftDesktopNodeViewMode] =
    useState<NodeViewMode>("large");
  const [draftMobileNodeViewMode, setDraftMobileNodeViewMode] =
    useState<NodeViewMode>("compact");
  const [draftBindings, setDraftBindings] = useState<HomepagePingTaskBindings>({});
  const [draftPingTaskOrder, setDraftPingTaskOrder] = useState<HomepagePingTaskOrder>({});
  const [draftPingAggregationStrategy, setDraftPingAggregationStrategy] =
    useState<HomepagePingAggregationStrategy>("worst");
  const [draftPingPrimaryTasks, setDraftPingPrimaryTasks] =
    useState<HomepagePingPrimaryTasks>({});
  const [draftPingTaskGroups, setDraftPingTaskGroups] =
    useState<HomepagePingTaskGroups>({});
  const [draftShowHomeOverview, setDraftShowHomeOverview] = useState(true);
  const [draftShowGroupTabs, setDraftShowGroupTabs] = useState(true);
  const [draftHomeGroupOrder, setDraftHomeGroupOrder] = useState<string[]>([]);
  const [draftFacetDimensions, setDraftFacetDimensions] = useState<HomeFacetDimension[]>(
    DEFAULT_HOME_FACET_DIMENSIONS,
  );
  const [draftHomeNodeFacets, setDraftHomeNodeFacets] = useState<HomeNodeFacets>({});
  const [draftHomeDefaultFacetDimension, setDraftHomeDefaultFacetDimension] =
    useState(HOME_FACET_LEGACY_GROUP);
  const [draftHomeSelectedNodeUuids, setDraftHomeSelectedNodeUuids] = useState<string[]>([]);
  const [draftHomeSavedViews, setDraftHomeSavedViews] = useState<HomeSavedView[]>([]);
  const [draftHomeDefaultSavedViewId, setDraftHomeDefaultSavedViewId] = useState("");
  const [draftMoveOfflineNodesBack, setDraftMoveOfflineNodesBack] = useState(true);
  const [draftShowCostSummary, setDraftShowCostSummary] = useState(true);
  const [draftShowCostSummaryFloatingButton, setDraftShowCostSummaryFloatingButton] =
    useState(true);
  const [draftShowOverviewRatings, setDraftShowOverviewRatings] = useState(true);
  const [draftOverviewRatingStyle, setDraftOverviewRatingStyle] =
    useState<OverviewRatingStyle>("plain");
  const [draftShowTrafficRating, setDraftShowTrafficRating] = useState(true);
  const [draftShowBandwidthRating, setDraftShowBandwidthRating] = useState(true);
  const [draftShowAssetRating, setDraftShowAssetRating] = useState(true);
  const [draftRatingLabels, setDraftRatingLabels] = useState<Record<OverviewRatingKind, string>>({
    traffic: "",
    bandwidth: "",
    asset: "",
  });
  const [draftCompactShowTrafficTotal, setDraftCompactShowTrafficTotal] = useState(true);
  const [draftCompactShowBilling, setDraftCompactShowBilling] = useState(true);
  const [draftCompactShowUptime, setDraftCompactShowUptime] = useState(true);
  const [draftShowConnections, setDraftShowConnections] = useState(false);
  const [draftCostIgnoredText, setDraftCostIgnoredText] = useState("");
  const [draftCostRateApiUrl, setDraftCostRateApiUrl] = useState(
    DEFAULT_THEME_SETTINGS.costRateApiUrl,
  );
  const [draftBackgroundImage, setDraftBackgroundImage] = useState("");
  const [draftBackgroundImageMobile, setDraftBackgroundImageMobile] = useState("");
  const [draftBackgroundAlignment, setDraftBackgroundAlignment] = useState(
    DEFAULT_THEME_SETTINGS.backgroundAlignment,
  );
  const [draftSurfaceOpacity, setDraftSurfaceOpacity] = useState(
    DEFAULT_THEME_SETTINGS.surfaceOpacity,
  );
  const [facetSearch, setFacetSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [timePreviewNow, setTimePreviewNow] = useState(() => Date.now());

  const {
    data: pingTasks,
    isLoading: tasksLoading,
    error: tasksError,
  } = useQuery({
    queryKey: ["admin", "ping-tasks"],
    queryFn: getAdminPingTasks,
    staleTime: 30_000,
    retry: false,
  });
  const {
    data: adminClients,
    isLoading: clientsLoading,
    error: clientsError,
  } = useQuery({
    queryKey: ["admin", "clients"],
    queryFn: getAdminClients,
    staleTime: 30_000,
    retry: false,
  });

  const sourceThemeSettings = useMemo(
    () => normalizeThemeSettings(config?.theme_settings),
    [config?.theme_settings],
  );
  // 服务端设置的内容签名。React Query 每次 ["public"] refetch(聚焦、过期、失效)都返回
  // 新的 `config` 对象,即使字节完全一样,每个 `source*` 值也会是新身份。用这个签名作为
  // reseed 的判断依据,并记录上次实际应用的值,这样内容相同的 refetch 不会冲掉未保存的草稿,
  // 而服务端数据真的变了时仍会重新 seed。
  const sourceSignature = useMemo(
    () => JSON.stringify(pickManagedThemeSettings(sourceThemeSettings)),
    [sourceThemeSettings],
  );
  const lastSeededSignatureRef = useRef<string | null>(null);

  // 把服务端设置灌入草稿字段的唯一出口,reseed effect 和重置按钮都走它,避免两边逻辑漂移。
  const seedDrafts = useCallback((next: ResolvedThemeSettings) => {
    setDraftAppearance(next.defaultAppearance);
    setDraftDisplayTimeZoneText(next.displayTimeZone);
    setDraftDesktopNodeViewMode(next.desktopNodeViewMode);
    setDraftMobileNodeViewMode(next.mobileNodeViewMode);
    setDraftBindings(next.homepagePingBindings);
    setDraftPingTaskOrder(next.homepagePingTaskOrder);
    setDraftPingAggregationStrategy(next.homepagePingAggregationStrategy);
    setDraftPingPrimaryTasks(next.homepagePingPrimaryTasks);
    setDraftPingTaskGroups(next.homepagePingTaskGroups);
    setDraftShowHomeOverview(next.showHomeOverview);
    setDraftShowGroupTabs(next.showGroupTabs);
    setDraftHomeGroupOrder(next.homeGroupOrder);
    setDraftFacetDimensions(next.homeFacetDimensions);
    setDraftHomeNodeFacets(next.homeNodeFacets);
    setDraftHomeDefaultFacetDimension(next.homeDefaultFacetDimension);
    setDraftHomeSelectedNodeUuids(next.homeSelectedNodeUuids);
    setDraftHomeSavedViews(next.homeSavedViews);
    setDraftHomeDefaultSavedViewId(next.homeDefaultSavedViewId);
    setDraftMoveOfflineNodesBack(next.moveOfflineNodesBack);
    setDraftShowCostSummary(next.showCostSummary);
    setDraftShowCostSummaryFloatingButton(next.showCostSummaryFloatingButton);
    setDraftShowOverviewRatings(next.showOverviewRatings);
    setDraftOverviewRatingStyle(next.overviewRatingStyle);
    setDraftShowTrafficRating(next.showTrafficRating);
    setDraftShowBandwidthRating(next.showBandwidthRating);
    setDraftShowAssetRating(next.showAssetRating);
    setDraftRatingLabels({
      traffic: next.trafficRatingLabels,
      bandwidth: next.bandwidthRatingLabels,
      asset: next.assetRatingLabels,
    });
    setDraftCompactShowTrafficTotal(next.compactShowTrafficTotal);
    setDraftCompactShowBilling(next.compactShowBilling);
    setDraftCompactShowUptime(next.compactShowUptime);
    setDraftShowConnections(next.showConnections);
    setDraftCostIgnoredText(next.costIgnoredNodes.join("\n"));
    setDraftCostRateApiUrl(next.costRateApiUrl);
    setDraftBackgroundImage(next.backgroundImage);
    setDraftBackgroundImageMobile(next.backgroundImageMobile);
    setDraftBackgroundAlignment(next.backgroundAlignment);
    setDraftSurfaceOpacity(next.surfaceOpacity);
  }, []);

  useEffect(() => {
    if (!config) return;
    if (lastSeededSignatureRef.current === sourceSignature) return;
    lastSeededSignatureRef.current = sourceSignature;
    seedDrafts(sourceThemeSettings);
  }, [config, sourceSignature, sourceThemeSettings, seedDrafts]);

  useEffect(() => {
    const timer = window.setInterval(() => setTimePreviewNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const sortedTasks = useMemo(() => sortTasks(pingTasks ?? []), [pingTasks]);
  const activePingTaskIds = useMemo(
    () => sortedTasks.map((task) => task.id),
    [sortedTasks],
  );
  const canValidatePingTasks = !tasksLoading && !tasksError;
  const sortedClients = useMemo(() => sortClients(adminClients ?? []), [adminClients]);
  // 后端实际存在的分组,按首页 Tab 的渲染顺序排列(已配置的在前,未排序的在后)。
  // 用户直接拖动这个列表来调整顺序。
  const availableGroups = useMemo(
    () => dedupeGroupLabels(sortedClients.map((client) => client.group)),
    [sortedClients],
  );
  const orderedDraftGroups = useMemo(
    () => sortHomeGroupOptions(availableGroups, draftHomeGroupOrder),
    [availableGroups, draftHomeGroupOrder],
  );
  const moveGroup = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedDraftGroups.length) return;
    const next = [...orderedDraftGroups];
    [next[index], next[target]] = [next[target], next[index]];
    setDraftHomeGroupOrder(next);
  };

  const visibleFacetClients = useMemo(() => {
    const keyword = facetSearch.trim().toLowerCase();
    if (!keyword) return sortedClients;
    return sortedClients.filter((client) => {
      const facetNode = buildHomeFacetNode(client, draftHomeNodeFacets);
      const haystack = [
        client.name,
        client.uuid,
        client.group,
        client.region,
        client.provider,
        client.business_role,
        client.tags,
        client.public_remark,
        client.remark,
        ...Object.values(facetNode.facets).flat(),
      ]
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ");
      return haystack.includes(keyword);
    });
  }, [draftHomeNodeFacets, facetSearch, sortedClients]);

  const draftCostIgnoredNodes = useMemo(
    () => normalizeCostIgnoredNodes(draftCostIgnoredText),
    [draftCostIgnoredText],
  );
  const normalizedDraftCostRateApiUrl = normalizeCostRateApiUrl(draftCostRateApiUrl);
  const draftCostRateApiUrlInvalid =
    draftCostRateApiUrl.trim() !== "" && !isCostRateApiUrlValid(draftCostRateApiUrl.trim());
  const draftDisplayTimeZoneInput = draftDisplayTimeZoneText.trim();
  const draftDisplayTimeZoneInvalid =
    draftDisplayTimeZoneInput !== "" &&
    draftDisplayTimeZoneInput.toLowerCase() !== SYSTEM_DISPLAY_TIME_ZONE &&
    !isValidIanaTimeZone(draftDisplayTimeZoneInput);
  const normalizedDraftDisplayTimeZone = normalizeDisplayTimeZone(draftDisplayTimeZoneText);
  const displayTimeZonePreview = draftDisplayTimeZoneInvalid
    ? "请输入有效的 IANA 时区，例如 Asia/Shanghai"
    : formatDisplayDateTime(timePreviewNow, normalizedDraftDisplayTimeZone, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
  const locallyPrunedDraftBindings = useMemo(
    () => pruneBindings(draftBindings),
    [draftBindings],
  );
  const prunedDraftBindings = useMemo(() => {
    const bindings = locallyPrunedDraftBindings;
    return canValidatePingTasks
      ? filterHomepagePingTaskBindings(bindings, activePingTaskIds)
      : bindings;
  }, [activePingTaskIds, canValidatePingTasks, locallyPrunedDraftBindings]);
  const normalizedDraftPingPrimaryTasks = useMemo(
    () => normalizeHomepagePingPrimaryTasks(draftPingPrimaryTasks, prunedDraftBindings),
    [draftPingPrimaryTasks, prunedDraftBindings],
  );
  const normalizedDraftPingTaskGroups = useMemo(
    () => {
      const taskGroups = normalizeHomepagePingTaskGroups(draftPingTaskGroups);
      return canValidatePingTasks
        ? filterHomepagePingTaskGroups(taskGroups, activePingTaskIds)
        : taskGroups;
    },
    [activePingTaskIds, canValidatePingTasks, draftPingTaskGroups],
  );
  const stalePingTaskIds = useMemo(() => {
    if (!canValidatePingTasks) return [];
    const active = new Set(activePingTaskIds);
    const referenced = new Set([
      ...Object.keys(locallyPrunedDraftBindings),
      ...Object.keys(normalizeHomepagePingTaskGroups(draftPingTaskGroups)),
    ]);
    return Array.from(referenced)
      .map(Number)
      .filter((taskId) => !active.has(taskId))
      .sort((left, right) => left - right);
  }, [activePingTaskIds, canValidatePingTasks, draftPingTaskGroups, locallyPrunedDraftBindings]);
  const normalizedDraftFacetDimensions = useMemo(
    () => normalizeHomeFacetDimensions(draftFacetDimensions),
    [draftFacetDimensions],
  );
  const normalizedDraftHomeNodeFacets = useMemo(
    () => normalizeHomeNodeFacets(draftHomeNodeFacets),
    [draftHomeNodeFacets],
  );
  const normalizedDraftHomeDefaultFacetDimension = useMemo(
    () =>
      normalizeHomeDefaultFacetDimension(
        draftHomeDefaultFacetDimension,
        normalizedDraftFacetDimensions,
      ),
    [draftHomeDefaultFacetDimension, normalizedDraftFacetDimensions],
  );
  const normalizedDraftHomeSelectedNodeUuids = useMemo(
    () => normalizeHomeSelectedNodeUuids(draftHomeSelectedNodeUuids),
    [draftHomeSelectedNodeUuids],
  );
  const normalizedDraftHomeSavedViews = useMemo(
    () => normalizeHomeSavedViews(draftHomeSavedViews, normalizedDraftFacetDimensions),
    [draftHomeSavedViews, normalizedDraftFacetDimensions],
  );
  const normalizedDraftHomeDefaultSavedViewId = useMemo(
    () => normalizeHomeDefaultSavedViewId(draftHomeDefaultSavedViewId, normalizedDraftHomeSavedViews),
    [draftHomeDefaultSavedViewId, normalizedDraftHomeSavedViews],
  );

  // 由当前草稿拼出的设置 payload,保存请求和 dirty 判断都用它。新增一项设置只需改这个对象
  // (和 seedDrafts),不必同时改六处。
  const draftThemeSettings = useMemo<ThemeSettings>(
    () => ({
      defaultAppearance: draftAppearance,
      displayTimeZone: normalizedDraftDisplayTimeZone,
      desktopNodeViewMode: draftDesktopNodeViewMode,
      mobileNodeViewMode: draftMobileNodeViewMode,
      homepagePingBindings: prunedDraftBindings,
      homepagePingTaskOrder: normalizeHomepagePingTaskOrder(draftPingTaskOrder, prunedDraftBindings),
      homepagePingAggregationStrategy: draftPingAggregationStrategy,
      homepagePingPrimaryTasks: normalizedDraftPingPrimaryTasks,
      homepagePingTaskGroups: normalizedDraftPingTaskGroups,
      showHomeOverview: draftShowHomeOverview,
      showGroupTabs: draftShowGroupTabs,
      homeGroupOrder: normalizeHomeGroupOrder(draftHomeGroupOrder),
      homeFacetDimensions: normalizedDraftFacetDimensions,
      homeNodeFacets: normalizedDraftHomeNodeFacets,
      homeDefaultFacetDimension: normalizedDraftHomeDefaultFacetDimension,
      homeSelectedNodeUuids: normalizedDraftHomeSelectedNodeUuids,
      homeSavedViews: normalizedDraftHomeSavedViews,
      homeDefaultSavedViewId: normalizedDraftHomeDefaultSavedViewId,
      moveOfflineNodesBack: draftMoveOfflineNodesBack,
      showCostSummary: draftShowCostSummary,
      showCostSummaryFloatingButton: draftShowCostSummaryFloatingButton,
      showOverviewRatings: draftShowOverviewRatings,
      overviewRatingStyle: draftOverviewRatingStyle,
      showTrafficRating: draftShowTrafficRating,
      showBandwidthRating: draftShowBandwidthRating,
      showAssetRating: draftShowAssetRating,
      trafficRatingLabels: draftRatingLabels.traffic,
      bandwidthRatingLabels: draftRatingLabels.bandwidth,
      assetRatingLabels: draftRatingLabels.asset,
      compactShowTrafficTotal: draftCompactShowTrafficTotal,
      compactShowBilling: draftCompactShowBilling,
      compactShowUptime: draftCompactShowUptime,
      showConnections: draftShowConnections,
      costIgnoredNodes: draftCostIgnoredNodes,
      costRateApiUrl: normalizedDraftCostRateApiUrl,
      backgroundImage: normalizeBackgroundUrl(draftBackgroundImage),
      backgroundImageMobile: normalizeBackgroundUrl(draftBackgroundImageMobile),
      backgroundAlignment: normalizeBackgroundAlignment(draftBackgroundAlignment),
      surfaceOpacity: draftSurfaceOpacity,
    }),
    [
      draftAppearance,
      draftPingTaskOrder,
      normalizedDraftDisplayTimeZone,
      draftDesktopNodeViewMode,
      draftMobileNodeViewMode,
      prunedDraftBindings,
      draftPingAggregationStrategy,
      normalizedDraftPingPrimaryTasks,
      normalizedDraftPingTaskGroups,
      draftShowHomeOverview,
      draftShowGroupTabs,
      draftHomeGroupOrder,
      normalizedDraftFacetDimensions,
      normalizedDraftHomeNodeFacets,
      normalizedDraftHomeDefaultFacetDimension,
      normalizedDraftHomeSelectedNodeUuids,
      normalizedDraftHomeSavedViews,
      normalizedDraftHomeDefaultSavedViewId,
      draftMoveOfflineNodesBack,
      draftShowCostSummary,
      draftShowCostSummaryFloatingButton,
      draftShowOverviewRatings,
      draftOverviewRatingStyle,
      draftShowTrafficRating,
      draftShowBandwidthRating,
      draftShowAssetRating,
      draftRatingLabels,
      draftCompactShowTrafficTotal,
      draftCompactShowBilling,
      draftCompactShowUptime,
      draftShowConnections,
      draftCostIgnoredNodes,
      normalizedDraftCostRateApiUrl,
      draftBackgroundImage,
      draftBackgroundImageMobile,
      draftBackgroundAlignment,
      draftSurfaceOpacity,
    ],
  );

  // 只比较本页实际管理的设置。enableAdminButton/showPingChart 这类隐藏设置会通过
  // baseSettings 在保存时保留,但不该让表单永远显示为 dirty。
  const draftSignature = useMemo(
    () => managedSettingsSignature(draftThemeSettings as ThemeSettings & Record<string, unknown>),
    [draftThemeSettings],
  );
  // draftSignature 用的是归一化后的 cost-rate URL,非法输入会被收敛回默认值,于是非法输入
  // 不会被判为 dirty,用户既无法保存也无法重置出来。所以单独跟踪原始文本,让编辑始终把表单
  // 标为 dirty(重置可用),而保存按钮再额外按合法性把关(见下文)。
  const costRateApiUrlDirty =
    draftCostRateApiUrl.trim() !== sourceThemeSettings.costRateApiUrl;
  const displayTimeZoneInputDirty =
    draftDisplayTimeZoneInvalid ||
    normalizedDraftDisplayTimeZone !== sourceThemeSettings.displayTimeZone;
  const isDirty =
    draftSignature !== sourceSignature || costRateApiUrlDirty || displayTimeZoneInputDirty;

  // 用户重新编辑后清掉「已保存」提示,避免过期的成功提示和 dirty 表单并存。
  useEffect(() => {
    if (isDirty) setMessage(null);
  }, [isDirty]);

  const boundClientCount = useMemo(
    () => countHomepagePingBoundClients(prunedDraftBindings),
    [prunedDraftBindings],
  );
  const bindingPairCount = useMemo(
    () => countHomepagePingBindingPairs(prunedDraftBindings),
    [prunedDraftBindings],
  );
  const pingDiagnostics = useMemo(
    () =>
      buildPingDiagnostics({
        tasks: sortedTasks,
        clients: sortedClients,
        bindings: prunedDraftBindings,
      }),
    [prunedDraftBindings, sortedClients, sortedTasks],
  );

  const pingClientBindingRows = useMemo(
    () =>
      buildHomepagePingClientBindingRows({
        clients: sortedClients,
        tasks: sortedTasks,
        bindings: prunedDraftBindings,
        primaryTasks: normalizedDraftPingPrimaryTasks,
        taskGroups: normalizedDraftPingTaskGroups,
      }),
    [
      normalizedDraftPingPrimaryTasks,
      normalizedDraftPingTaskGroups,
      prunedDraftBindings,
      sortedClients,
      sortedTasks,
    ],
  );
  const activeAggregationOption =
    PING_AGGREGATION_OPTIONS.find((option) => option.value === draftPingAggregationStrategy) ??
    PING_AGGREGATION_OPTIONS[0];
  const setPrimaryPingTask = (clientUuid: string, taskId: number | null) => {
    setDraftPingPrimaryTasks((prev) => {
      const next = { ...prev };
      if (taskId == null) delete next[clientUuid];
      else next[clientUuid] = taskId;
      return next;
    });
  };
  const setNodeFacetValues = (clientUuid: string, dimensionId: string, text: string) => {
    const values = normalizeHomeFacetValues(text);
    setDraftHomeNodeFacets((prev) => {
      const next: HomeNodeFacets = { ...prev };
      const nodeFacets = { ...(next[clientUuid] ?? {}) };
      if (values.length > 0) nodeFacets[dimensionId] = values;
      else delete nodeFacets[dimensionId];
      if (Object.keys(nodeFacets).length > 0) next[clientUuid] = nodeFacets;
      else delete next[clientUuid];
      return normalizeHomeNodeFacets(next);
    });
  };
  const updateFacetDimension = (
    dimensionId: string,
    patch: Partial<Pick<HomeFacetDimension, "label" | "visible" | "order">>,
  ) => {
    setDraftFacetDimensions((prev) =>
      normalizeHomeFacetDimensions(
        prev.map((dimension) =>
          dimension.id === dimensionId ? { ...dimension, ...patch } : dimension,
        ),
      ),
    );
  };
  const moveFacetDimension = (dimensionId: string, direction: -1 | 1) => {
    setDraftFacetDimensions((prev) => {
      const ordered = normalizeHomeFacetDimensions(prev);
      const index = ordered.findIndex((dimension) => dimension.id === dimensionId);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= ordered.length) return ordered;
      const next = [...ordered];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((dimension, orderIndex) => ({ ...dimension, order: (orderIndex + 1) * 10 }));
    });
  };
  const addFacetDimension = () => {
    setDraftFacetDimensions((prev) => {
      const normalized = normalizeHomeFacetDimensions(prev);
      const id = createCustomDimensionId(normalized);
      return normalizeHomeFacetDimensions([
        ...normalized,
        { id, label: "新维度", visible: true, order: (normalized.length + 1) * 10 },
      ]);
    });
  };
  const removeFacetDimension = (dimensionId: string) => {
    if (DEFAULT_HOME_FACET_IDS.has(dimensionId)) return;
    setDraftFacetDimensions((prev) => prev.filter((dimension) => dimension.id !== dimensionId));
    setDraftHomeNodeFacets((prev) => {
      const next: HomeNodeFacets = {};
      for (const [uuid, facets] of Object.entries(prev)) {
        const nodeFacets = { ...facets };
        delete nodeFacets[dimensionId];
        if (Object.keys(nodeFacets).length > 0) next[uuid] = nodeFacets;
      }
      return next;
    });
    setDraftHomeSavedViews((prev) =>
      prev.map((view) => ({
        ...view,
        filters: clearFacetFilter(view.filters, dimensionId),
        groupBy: view.groupBy === dimensionId ? HOME_FACET_LEGACY_GROUP : view.groupBy,
      })),
    );
    if (draftHomeDefaultFacetDimension === dimensionId) {
      setDraftHomeDefaultFacetDimension(HOME_FACET_LEGACY_GROUP);
    }
  };
  const addSavedView = () => {
    setDraftHomeSavedViews((prev) => {
      const id = createSavedViewId(prev);
      return normalizeHomeSavedViews(
        [
          ...prev,
          {
            id,
            name: `视图 ${prev.length + 1}`,
            selectedNodeUuids: [],
            filters: {},
            groupBy: normalizedDraftHomeDefaultFacetDimension,
            sortKey: "weight",
            sorts: DEFAULT_VPS_LIST_SORTS,
          },
        ],
        normalizedDraftFacetDimensions,
      );
    });
  };
  const updateSavedView = (viewId: string, patch: Partial<HomeSavedView>) => {
    setDraftHomeSavedViews((prev) =>
      normalizeHomeSavedViews(
        prev.map((view) => (view.id === viewId ? { ...view, ...patch } : view)),
        normalizedDraftFacetDimensions,
      ),
    );
  };
  const removeSavedView = (viewId: string) => {
    setDraftHomeSavedViews((prev) => prev.filter((view) => view.id !== viewId));
    if (draftHomeDefaultSavedViewId === viewId) setDraftHomeDefaultSavedViewId("");
  };

  const handleSave = async () => {
    if (!config?.theme) return;
    if (draftDisplayTimeZoneInvalid) {
      setError("显示时区不是有效的 IANA 时区");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const baseSettings: ThemeSettings & Record<string, unknown> = {
        ...(config.theme_settings ?? {}),
      };
      delete baseSettings.homepagePingTask;
      const nextSettings: ThemeSettings & Record<string, unknown> = {
        ...baseSettings,
        ...draftThemeSettings,
      };
      await saveThemeSettings(config.theme, nextSettings);
      await queryClient.invalidateQueries({ queryKey: ["public"] });
      setMessage("主题设置已保存");
    } catch (saveError) {
      if (
        saveError instanceof ApiRequestError &&
        (saveError.status === 401 || saveError.status === 403)
      ) {
        setAccessRevoked(true);
        return;
      }
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    seedDrafts(sourceThemeSettings);
    setMessage(null);
    setError(null);
  };

  if (configLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (accessRevoked) {
    return <Navigate to="/" replace />;
  }

  const adminAccessDenied =
    (tasksError instanceof ApiRequestError &&
      (tasksError.status === 401 || tasksError.status === 403)) ||
    (clientsError instanceof ApiRequestError &&
      (clientsError.status === 401 || clientsError.status === 403));

  if (adminAccessDenied) {
    return <Navigate to="/" replace />;
  }

  const adminError =
    (tasksError instanceof Error ? tasksError.message : null) ||
    (clientsError instanceof Error ? clientsError.message : null);
  const noTasksYet = !tasksLoading && !clientsLoading && sortedTasks.length === 0;
  const setRatingLabelDraft = (kind: OverviewRatingKind, value: string) => {
    setDraftRatingLabels((prev) => ({ ...prev, [kind]: value }));
  };
  const draftBgAlignment = parseBackgroundAlignment(draftBackgroundAlignment);
  const setBgSize = (size: BackgroundSize) =>
    setDraftBackgroundAlignment(`${size},${draftBgAlignment.position}`);
  const setBgPosition = (position: BackgroundPosition) =>
    setDraftBackgroundAlignment(`${draftBgAlignment.size},${position}`);
  const hasBackgroundImage = Boolean(
    normalizeBackgroundUrl(draftBackgroundImage) ||
      normalizeBackgroundUrl(draftBackgroundImageMobile),
  );

  return (
    <div className="flex flex-col gap-5 py-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="instance-page-back">
          <ArrowLeft size={14} />
          返回首页
        </Link>
        <div className="theme-manage-toolbar-actions">
          <button
            type="button"
            onClick={handleReset}
            disabled={!isDirty || saving}
            className="theme-manage-button"
          >
            <RefreshCw size={14} />
            <span>重置</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || saving || draftCostRateApiUrlInvalid || draftDisplayTimeZoneInvalid}
            className="theme-manage-button is-primary"
          >
            {saving ? <Spinner size={14} /> : <Save size={14} />}
            <span>{saving ? "保存中" : "保存设置"}</span>
          </button>
        </div>
      </div>

      <InstancePanel
        title="Aster 主题设置"
        description="集中调整 Aster 的展示偏好与首页延迟绑定；保存后会立即应用到当前站点。"
        aside={
          <div className="text-right text-[11px] text-[var(--text-tertiary)]">
            <div>主题: {config?.theme || "Komari-Theme-Aster"}</div>
            <div>
              已绑定首页 Ping 节点 {boundClientCount} / {sortedClients.length}
              {bindingPairCount > boundClientCount ? ` · ${bindingPairCount} 关系` : ""}
            </div>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {message && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-online)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-online)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-online)]"
            >
              {message}
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              {error}
            </div>
          )}
          {adminError && (
            <div
              role="alert"
              className="rounded-[12px] border border-[color-mix(in_srgb,var(--status-offline)_28%,transparent)] bg-[color-mix(in_srgb,var(--status-offline)_11%,var(--surface))] px-4 py-3 text-[13px] text-[var(--status-offline)]"
            >
              无法读取后台 Ping 任务或节点列表: {adminError}
            </div>
          )}
        </div>
      </InstancePanel>

      <InstancePanel
        title="默认外观"
        description="为首次访问或尚未手动切换外观的用户设置默认显示模式；后续仍可在首页右上角按需切换。"
        aside={<LayoutTemplate size={16} />}
      >
        <div className="instance-segmented is-scrollable">
          {APPEARANCE_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              data-active={draftAppearance === value ? "true" : "false"}
              aria-pressed={draftAppearance === value}
              onClick={() => setDraftAppearance(value)}
              className="inline-flex items-center justify-center gap-2"
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </InstancePanel>

      <InstancePanel
        title="显示时区"
        description="统一控制主题内绝对时间的显示时区；数据本身和查询时间戳保持不变。"
        aside={<Globe2 size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                快速选择
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                当前: {describeDisplayTimeZone(normalizedDraftDisplayTimeZone)}
              </div>
            </div>
            <div className="instance-segmented is-scrollable">
              {DISPLAY_TIME_ZONE_PRESETS.map((timeZone) => (
                <button
                  key={timeZone}
                  type="button"
                  data-active={
                    !draftDisplayTimeZoneInvalid && normalizedDraftDisplayTimeZone === timeZone
                      ? "true"
                      : "false"
                  }
                  aria-pressed={
                    !draftDisplayTimeZoneInvalid && normalizedDraftDisplayTimeZone === timeZone
                  }
                  onClick={() => setDraftDisplayTimeZoneText(timeZone)}
                >
                  {DISPLAY_TIME_ZONE_LABELS[timeZone] ?? timeZone}
                </button>
              ))}
            </div>
          </div>

          <label className="surface-inset flex flex-col gap-2 px-4 py-4">
            <span className="text-[13px] font-semibold text-[var(--text-primary)]">
              自定义 IANA 时区
            </span>
            <input
              value={draftDisplayTimeZoneText}
              onChange={(event) => setDraftDisplayTimeZoneText(event.target.value)}
              placeholder="Asia/Shanghai"
              className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              aria-invalid={draftDisplayTimeZoneInvalid}
            />
            <span
              className={clsx(
                "text-[11px] leading-relaxed",
                draftDisplayTimeZoneInvalid
                  ? "text-[var(--status-offline)]"
                  : "text-[var(--text-tertiary)]",
              )}
            >
              {draftDisplayTimeZoneInvalid
                ? "无法识别该时区，请使用 IANA 名称。"
                : "留空或填 system 即跟随浏览器。"}
            </span>
          </label>
        </div>

        <div className="surface-inset mt-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="text-[12px] text-[var(--text-tertiary)]">当前显示时间</span>
          <strong className="text-[15px] tabular text-[var(--text-primary)]">
            {displayTimeZonePreview}
          </strong>
        </div>
      </InstancePanel>

      <InstancePanel
        title="默认卡片视图"
        description="分别设置桌面端与移动端的默认卡片尺寸；首页右上角按钮只临时切换当前设备的显示。"
        aside={<LayoutGrid size={16} />}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                桌面端默认
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                适用于宽度大于 720px 的浏览器窗口。
              </div>
            </div>
            <div className="instance-segmented is-scrollable">
              {NODE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-active={draftDesktopNodeViewMode === value ? "true" : "false"}
                  aria-pressed={draftDesktopNodeViewMode === value}
                  onClick={() => setDraftDesktopNodeViewMode(value)}
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div>
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                移动端默认
              </div>
              <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                适用于宽度小于等于 720px 的手机或窄屏窗口。
              </div>
            </div>
            <div className="instance-segmented is-scrollable">
              {NODE_VIEW_MODE_OPTIONS.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  data-active={draftMobileNodeViewMode === value ? "true" : "false"}
                  aria-pressed={draftMobileNodeViewMode === value}
                  onClick={() => setDraftMobileNodeViewMode(value)}
                  className="inline-flex items-center justify-center gap-2"
                >
                  <Icon size={14} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        title="背景与透明度"
        description="为站点设置自定义背景图，并调节卡片不透明度。背景图可分别为浅色 / 深色与桌面 / 移动端设置；卡片不透明度调低后会自动加上磨砂玻璃与可读性遮罩。"
        aside={<Wallpaper size={16} />}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                桌面端背景图
              </span>
              <input
                value={draftBackgroundImage}
                onChange={(event) => setDraftBackgroundImage(event.target.value)}
                placeholder="https://example.com/bg.webp"
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              <span className="text-[11px] text-[var(--text-tertiary)]">
                留空则不显示背景图。可用 <code>浅色图|深色图</code> 为两种外观分别设置。
              </span>
            </label>
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                移动端背景图
              </span>
              <input
                value={draftBackgroundImageMobile}
                onChange={(event) => setDraftBackgroundImageMobile(event.target.value)}
                placeholder="留空则沿用桌面端背景图"
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              <span className="text-[11px] text-[var(--text-tertiary)]">
                屏宽 ≤ 720px 时生效；同样支持 <code>浅色图|深色图</code> 写法。
              </span>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="surface-inset flex flex-col gap-3 px-4 py-4">
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">缩放方式</div>
              <div className="instance-segmented is-scrollable">
                {BACKGROUND_SIZE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    data-active={draftBgAlignment.size === value ? "true" : "false"}
                    aria-pressed={draftBgAlignment.size === value}
                    onClick={() => setBgSize(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="surface-inset flex flex-col gap-3 px-4 py-4">
              <div className="text-[13px] font-semibold text-[var(--text-primary)]">对齐位置</div>
              <div className="instance-segmented is-scrollable">
                {BACKGROUND_POSITION_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    data-active={draftBgAlignment.position === value ? "true" : "false"}
                    aria-pressed={draftBgAlignment.position === value}
                    onClick={() => setBgPosition(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="surface-inset flex flex-col gap-3 px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                卡片不透明度
              </span>
              <span className="inline-flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  inputMode="numeric"
                  value={draftSurfaceOpacity}
                  onChange={(event) => {
                    // Number("") === 0,没有这行的话清空输入框(想重新输入)会把值跳成 0。
                    if (event.target.value.trim() === "") return;
                    const next = Number(event.target.value);
                    if (!Number.isFinite(next)) return;
                    setDraftSurfaceOpacity(Math.min(100, Math.max(0, Math.round(next))));
                  }}
                  aria-label="卡片不透明度百分比"
                  className="surface-inset w-20 px-3 py-2 text-right text-[13px] tabular outline-none"
                />
                <span className="text-[13px] font-medium text-[var(--text-tertiary)]">%</span>
              </span>
            </div>
            <span className="text-[11px] leading-relaxed text-[var(--text-tertiary)]">
              输入 0–100 的整数。100 = 完全不透明（与默认主题一致），数值越低卡片越通透、越能透出背景图。
              {hasBackgroundImage
                ? " 低于 95 时会自动叠加磨砂玻璃与可读性遮罩，保证文字清晰。"
                : " 需先在上方设置背景图后才会生效。"}
            </span>
          </div>
        </div>
      </InstancePanel>

      <InstancePanel
        title="首页巡检"
        description="控制首页顶部总览、分组筛选和节点排序方式；适合节点较多时快速查看状态。"
        aside={<ListFilter size={16} />}
      >
        <div className="grid gap-3 md:grid-cols-3">
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示顶部总览
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                展示时间、在线数、地区、流量和速率。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftShowHomeOverview}
              onChange={(event) => setDraftShowHomeOverview(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示分组筛选
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                根据后端节点分组生成首页 Tab。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftShowGroupTabs}
              onChange={(event) => setDraftShowGroupTabs(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                离线节点后移
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                当前分组内在线优先，离线排到后方。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftMoveOfflineNodesBack}
              onChange={(event) => setDraftMoveOfflineNodesBack(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className="text-[13px] font-medium text-[var(--text-primary)]">分组排序</span>
            <span className="text-[11px] text-[var(--text-tertiary)]">
              调整首页分组 Tab 的显示顺序；未列出的分组按后端顺序排在后面。
            </span>
          </div>
          {orderedDraftGroups.length === 0 ? (
            <p className="surface-inset mt-2 px-4 py-3 text-[12px] text-[var(--text-tertiary)]">
              {clientsLoading ? "正在加载分组…" : "暂无分组（节点未设置分组时无需排序）"}
            </p>
          ) : (
            <ul className="mt-2 flex flex-col gap-2">
              {orderedDraftGroups.map((group, index) => (
                <li
                  key={group}
                  className="surface-inset flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="tabular text-[12px] text-[var(--text-tertiary)]">
                      {index + 1}
                    </span>
                    <span
                      className="truncate text-[13px] text-[var(--text-primary)]"
                      title={group}
                    >
                      {group}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveGroup(index, -1)}
                      className="theme-manage-button is-compact"
                      aria-label={`上移 ${group}`}
                    >
                      <ChevronUp size={14} />
                    </button>
                    <button
                      type="button"
                      disabled={index === orderedDraftGroups.length - 1}
                      onClick={() => moveGroup(index, 1)}
                      className="theme-manage-button is-compact"
                      aria-label={`下移 ${group}`}
                    >
                      <ChevronDown size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-4 surface-inset px-4 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-[var(--text-primary)]">
                总览评级
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                在累计流量、实时带宽、资产概览右下角显示文字评级；名称用英文逗号分隔，只取前四个。
              </span>
            </span>
            <label className="inline-flex shrink-0 items-center gap-2 text-[12px] font-medium text-[var(--text-secondary)]">
              <span>启用</span>
              <input
                type="checkbox"
                checked={draftShowOverviewRatings}
                onChange={(event) => setDraftShowOverviewRatings(event.target.checked)}
                className="h-4 w-4 accent-[var(--accent-500)]"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="flex flex-col gap-3">
              <div>
                <div className="mb-2 text-[12px] font-medium text-[var(--text-secondary)]">
                  评级风格
                </div>
                <div className="instance-segmented is-scrollable">
                  {OVERVIEW_RATING_STYLES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      data-active={draftOverviewRatingStyle === option.value ? "true" : "false"}
                      aria-pressed={draftOverviewRatingStyle === option.value}
                      disabled={!draftShowOverviewRatings}
                      onClick={() => setDraftOverviewRatingStyle(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>累计流量</span>
                  <input
                    type="checkbox"
                    checked={draftShowTrafficRating}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setDraftShowTrafficRating(event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>实时带宽</span>
                  <input
                    type="checkbox"
                    checked={draftShowBandwidthRating}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setDraftShowBandwidthRating(event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
                <label className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-secondary)]">
                  <span>资产概览</span>
                  <input
                    type="checkbox"
                    checked={draftShowAssetRating}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setDraftShowAssetRating(event.target.checked)}
                    className="h-4 w-4 accent-[var(--accent-500)]"
                  />
                </label>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              {OVERVIEW_RATING_LABEL_FIELDS.map((field) => (
                <label key={field.key} className="flex min-w-0 flex-col gap-2">
                  <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                    {field.title}
                  </span>
                  <input
                    value={draftRatingLabels[field.key]}
                    disabled={!draftShowOverviewRatings}
                    onChange={(event) => setRatingLabelDraft(field.key, event.target.value)}
                    placeholder={getDefaultOverviewRatingLabelText(
                      field.key,
                      draftOverviewRatingStyle,
                    )}
                    className="surface-inset w-full px-3 py-2 text-[13px] outline-none disabled:opacity-60"
                  />
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    例如: {getDefaultOverviewRatingLabelText(field.key, draftOverviewRatingStyle)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
	      </InstancePanel>

	      <InstancePanel
	        title="VPS 标签与视图"
	        description="为首页多维筛选维护标签、默认展示 VPS 与保存视图；旧分组会继续作为兼容维度使用。"
	        aside={<Tags size={16} />}
	      >
	        <div className="flex flex-col gap-4">
	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  筛选维度
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  控制首页维度切换栏的显示顺序、名称和默认维度。
	                </div>
	              </div>
	              <div className="flex flex-wrap items-center gap-2">
	                <label className="surface-inset flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
	                  <span className="shrink-0">默认</span>
	                  <select
	                    value={normalizedDraftHomeDefaultFacetDimension}
	                    onChange={(event) => setDraftHomeDefaultFacetDimension(event.target.value)}
	                    className="bg-transparent text-[12px] outline-none"
	                  >
	                    {normalizedDraftFacetDimensions
	                      .filter((dimension) => dimension.visible)
	                      .map((dimension) => (
	                        <option key={dimension.id} value={dimension.id}>
	                          {dimension.label}
	                        </option>
	                      ))}
	                  </select>
	                </label>
	                <button type="button" className="theme-manage-button is-compact" onClick={addFacetDimension}>
	                  <Plus size={13} />
	                  <span>新增维度</span>
	                </button>
	              </div>
	            </div>
	            <div className="mt-3 flex flex-col gap-2">
	              {normalizedDraftFacetDimensions.map((dimension, index) => (
	                <div
	                  key={dimension.id}
	                  className="rounded-[12px] border border-[var(--hairline)] px-3 py-3"
	                >
	                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
	                    <label className="flex min-w-0 items-center gap-2">
	                      <span className="w-20 shrink-0 text-[11px] font-medium text-[var(--text-tertiary)]">
	                        {dimension.id}
	                      </span>
	                      <input
	                        value={dimension.label}
	                        onChange={(event) => updateFacetDimension(dimension.id, { label: event.target.value })}
	                        className="surface-inset min-w-0 flex-1 px-3 py-2 text-[12px] outline-none"
	                        aria-label={`设置 ${dimension.id} 的维度名称`}
	                      />
	                    </label>
	                    <label className="inline-flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
	                      <input
	                        type="checkbox"
	                        checked={dimension.visible}
	                        onChange={(event) =>
	                          updateFacetDimension(dimension.id, { visible: event.target.checked })
	                        }
	                        className="h-4 w-4 accent-[var(--accent-500)]"
	                      />
	                      <span>首页显示</span>
	                    </label>
	                    <span className="flex items-center gap-1">
	                      <button
	                        type="button"
	                        disabled={index === 0}
	                        onClick={() => moveFacetDimension(dimension.id, -1)}
	                        className="theme-manage-button is-compact"
	                        aria-label={`上移 ${dimension.label}`}
	                      >
	                        <ChevronUp size={14} />
	                      </button>
	                      <button
	                        type="button"
	                        disabled={index === normalizedDraftFacetDimensions.length - 1}
	                        onClick={() => moveFacetDimension(dimension.id, 1)}
	                        className="theme-manage-button is-compact"
	                        aria-label={`下移 ${dimension.label}`}
	                      >
	                        <ChevronDown size={14} />
	                      </button>
	                      {!DEFAULT_HOME_FACET_IDS.has(dimension.id) && (
	                        <button
	                          type="button"
	                          onClick={() => removeFacetDimension(dimension.id)}
	                          className="theme-manage-button is-compact is-danger"
	                          aria-label={`删除 ${dimension.label}`}
	                        >
	                          <Trash2 size={13} />
	                        </button>
	                      )}
	                    </span>
	                  </div>
	                </div>
	              ))}
	            </div>
	          </section>

	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  VPS 多维标签
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  每个输入框可写多个值，用分号、逗号或换行分隔；后端已有字段会作为默认标签参与首页筛选。官方 Komari 未提供厂商、用途字段时，这里的首个值也会补全到首页筛选和列表展示。
	                </div>
	              </div>
	              <label className="surface-inset flex min-w-[220px] items-center gap-2 px-3 py-2">
	                <Search size={14} className="text-[var(--text-tertiary)]" />
	                <input
	                  value={facetSearch}
	                  onChange={(event) => setFacetSearch(event.target.value)}
	                  placeholder="搜索 VPS / UUID / 标签"
	                  className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[var(--text-tertiary)]"
	                />
	              </label>
	            </div>
	            <div className="mt-3 grid max-h-[460px] gap-3 overflow-auto pr-1">
	              {visibleFacetClients.map((client) => {
	                const facetNode = buildHomeFacetNode(client, normalizedDraftHomeNodeFacets);
	                const configured = normalizedDraftHomeNodeFacets[client.uuid] ?? {};
	                return (
	                  <article
	                    key={client.uuid}
	                    className="rounded-[12px] border border-[var(--hairline)] px-3 py-3"
	                  >
	                    <div className="flex flex-wrap items-center justify-between gap-2">
	                      <span className="min-w-0">
	                        <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">
	                          {client.name}
	                        </span>
	                        <span className="mt-0.5 block truncate text-[10px] text-[var(--text-tertiary)]">
	                          {[client.group, client.region, client.uuid].filter(Boolean).join(" · ")}
	                        </span>
	                      </span>
	                      {draftHomeSelectedNodeUuids.includes(client.uuid) && (
	                        <span className="rounded-full border border-[color-mix(in_srgb,var(--accent-500)_30%,var(--hairline))] px-2 py-0.5 text-[10px] text-[var(--accent-600)]">
	                          默认展示
	                        </span>
	                      )}
	                    </div>
	                    <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
	                      {normalizedDraftFacetDimensions.map((dimension) => (
	                        <label key={dimension.id} className="flex min-w-0 flex-col gap-1.5">
	                          <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
	                            {dimension.label}
	                          </span>
	                          <input
	                            value={formatFacetValues(configured[dimension.id])}
	                            onChange={(event) =>
	                              setNodeFacetValues(client.uuid, dimension.id, event.target.value)
	                            }
	                            placeholder={formatFacetValues(facetNode.facets[dimension.id]) || "未设置"}
	                            className="surface-inset w-full px-3 py-2 text-[12px] outline-none"
	                          />
	                        </label>
	                      ))}
	                    </div>
	                  </article>
	                );
	              })}
	              {visibleFacetClients.length === 0 && (
	                <div className="rounded-[12px] border border-dashed border-[var(--hairline)] px-4 py-5 text-[12px] text-[var(--text-tertiary)]">
	                  没有匹配的 VPS。
	                </div>
	              )}
	            </div>
	          </section>

	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  默认指定展示
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  首页首次打开时只展示这里列出的 VPS；留空则展示全部可见 VPS。
	                </div>
	              </div>
	              <span className="text-[11px] text-[var(--text-tertiary)]">
	                {normalizedDraftHomeSelectedNodeUuids.length} 台
	              </span>
	            </div>
	            <textarea
	              value={draftHomeSelectedNodeUuids.join("\n")}
	              onChange={(event) =>
	                setDraftHomeSelectedNodeUuids(normalizeHomeSelectedNodeUuids(event.target.value))
	              }
	              placeholder="每行一个 VPS UUID，也可以用逗号分隔"
	              className="surface-inset mt-3 min-h-[96px] w-full resize-y px-3 py-2 text-[12px] outline-none"
	            />
	          </section>

	          <section className="surface-inset px-4 py-4">
	            <div className="flex flex-wrap items-start justify-between gap-3">
	              <div>
	                <div className="text-[13px] font-semibold text-[var(--text-primary)]">
	                  保存视图
	                </div>
	                <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
	                  保存常用的指定 VPS、维度筛选、排序和默认分组维度，首页可一键切换。
	                </div>
	              </div>
	              <div className="flex flex-wrap items-center gap-2">
	                <label className="surface-inset flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
	                  <span className="shrink-0">默认视图</span>
	                  <select
	                    value={normalizedDraftHomeDefaultSavedViewId}
	                    onChange={(event) => setDraftHomeDefaultSavedViewId(event.target.value)}
	                    className="bg-transparent text-[12px] outline-none"
	                  >
	                    <option value="">无</option>
	                    {normalizedDraftHomeSavedViews.map((view) => (
	                      <option key={view.id} value={view.id}>
	                        {view.name}
	                      </option>
	                    ))}
	                  </select>
	                </label>
	                <button type="button" className="theme-manage-button is-compact" onClick={addSavedView}>
	                  <Plus size={13} />
	                  <span>新增视图</span>
	                </button>
	              </div>
	            </div>
	            <div className="mt-3 grid gap-3">
	              {normalizedDraftHomeSavedViews.map((view) => (
	                <article key={view.id} className="rounded-[12px] border border-[var(--hairline)] px-3 py-3">
	                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(150px,190px)_minmax(150px,190px)_auto] md:items-center">
	                    <label className="flex min-w-0 items-center gap-2">
	                      <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">
	                        {view.id}
	                      </span>
	                      <input
	                        value={view.name}
	                        onChange={(event) => updateSavedView(view.id, { name: event.target.value })}
	                        className="surface-inset min-w-0 flex-1 px-3 py-2 text-[12px] outline-none"
	                        aria-label={`重命名视图 ${view.id}`}
	                      />
	                    </label>
	                    <select
	                      value={view.groupBy}
	                      onChange={(event) => updateSavedView(view.id, { groupBy: event.target.value })}
	                      className="surface-inset px-3 py-2 text-[12px] outline-none"
	                      aria-label={`设置 ${view.name} 的分组维度`}
	                    >
	                      {normalizedDraftFacetDimensions.map((dimension) => (
	                        <option key={dimension.id} value={dimension.id}>
	                          {dimension.label}
	                        </option>
	                      ))}
	                    </select>
	                    <select
	                      value={view.sortKey}
	                      onChange={(event) => updateSavedView(view.id, { sortKey: event.target.value })}
	                      className="surface-inset px-3 py-2 text-[12px] outline-none"
	                      aria-label={`设置 ${view.name} 的排序`}
	                    >
	                      {HOME_VIEW_SORT_OPTIONS.map((option) => (
	                        <option key={option.value} value={option.value}>
	                          {option.label}
	                        </option>
	                      ))}
	                    </select>
	                    <button
	                      type="button"
	                      onClick={() => removeSavedView(view.id)}
	                      className="theme-manage-button is-compact is-danger"
	                    >
	                      <Trash2 size={13} />
	                      <span>删除</span>
	                    </button>
	                  </div>
	                  <SavedViewSortEditor
	                    viewName={view.name}
	                    sorts={view.sorts}
	                    onChange={(sorts) => updateSavedView(view.id, { sorts })}
	                  />
	                  <div className="mt-3 grid gap-2 md:grid-cols-2">
	                    <label className="flex min-w-0 flex-col gap-1.5">
	                      <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
	                        指定 VPS
	                      </span>
	                      <textarea
	                        value={view.selectedNodeUuids.join("\n")}
	                        onChange={(event) =>
	                          updateSavedView(view.id, {
	                            selectedNodeUuids: normalizeHomeSelectedNodeUuids(event.target.value),
	                          })
	                        }
	                        placeholder="每行一个 VPS UUID；留空则不限制"
	                        className="surface-inset min-h-[92px] w-full resize-y px-3 py-2 text-[12px] outline-none"
	                      />
	                    </label>
	                    <label className="flex min-w-0 flex-col gap-1.5">
	                      <span className="text-[11px] font-medium text-[var(--text-tertiary)]">
	                        维度筛选
	                      </span>
	                      <textarea
	                        value={formatSavedViewFilters(view.filters)}
	                        onChange={(event) =>
	                          updateSavedView(view.id, {
	                            filters: parseSavedViewFilters(event.target.value),
	                          })
	                        }
	                        placeholder="provider=DMIT&#10;region=日本&#10;line=CMI; CN2"
	                        className="surface-inset min-h-[92px] w-full resize-y px-3 py-2 text-[12px] outline-none"
	                      />
	                    </label>
	                  </div>
	                </article>
	              ))}
	              {normalizedDraftHomeSavedViews.length === 0 && (
	                <div className="rounded-[12px] border border-dashed border-[var(--hairline)] px-4 py-5 text-[12px] text-[var(--text-tertiary)]">
	                  暂无保存视图。
	                </div>
	              )}
	            </div>
	          </section>
	        </div>
	      </InstancePanel>

	      <InstancePanel
	        title="小卡片显示项"
        description="控制小卡片中间信息块的密度；实时速率始终显示，其他两项可以按需隐藏。"
        aside={<Rows3 size={16} />}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示累计流量
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                展示出站与入站累计流量。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftCompactShowTrafficTotal}
              onChange={(event) => setDraftCompactShowTrafficTotal(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示费用到期
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                展示续费价格与剩余天数。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftCompactShowBilling}
              onChange={(event) => setDraftCompactShowBilling(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示在线时间
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                在小卡片流量栏右侧展示在线时长。默认开启。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftCompactShowUptime}
              onChange={(event) => setDraftCompactShowUptime(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
          <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                显示连接数（TCP/UDP）
              </span>
              <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                在大卡片与小卡片展示实时 TCP / UDP 连接数；需被控端上报，未上报显示 0。默认关闭。
              </span>
            </span>
            <input
              type="checkbox"
              checked={draftShowConnections}
              onChange={(event) => setDraftShowConnections(event.target.checked)}
              className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
            />
          </label>
        </div>
      </InstancePanel>

      <InstancePanel
        title="服务器花费"
        description="首页花费统计会使用实时汇率计算年化总支出、月均支出与剩余价值；忽略列表中的节点不会计入费用。"
        aside={<CircleDollarSign size={16} />}
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="flex flex-col gap-3">
            <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0 text-[13px] font-medium text-[var(--text-primary)]">
                显示首页花费统计
              </span>
              <input
                type="checkbox"
                checked={draftShowCostSummary}
                onChange={(event) => setDraftShowCostSummary(event.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
              />
            </label>
            <label className="surface-inset flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-[var(--text-primary)]">
                  显示资产悬浮按钮
                </span>
                <span className="mt-1 block text-[11px] text-[var(--text-tertiary)]">
                  关闭顶部总览时，仍可通过悬浮按钮打开资产详情。
                </span>
              </span>
              <input
                type="checkbox"
                checked={draftShowCostSummaryFloatingButton}
                onChange={(event) =>
                  setDraftShowCostSummaryFloatingButton(event.target.checked)
                }
                className="h-4 w-4 shrink-0 accent-[var(--accent-500)]"
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-[12px] font-medium text-[var(--text-secondary)]">
                实时汇率接口
              </span>
              <input
                value={draftCostRateApiUrl}
                onChange={(event) => setDraftCostRateApiUrl(event.target.value)}
                placeholder={DEFAULT_THEME_SETTINGS.costRateApiUrl}
                aria-invalid={draftCostRateApiUrlInvalid}
                className="surface-inset w-full px-3 py-2 text-[13px] outline-none"
              />
              {draftCostRateApiUrlInvalid && (
                <span className="text-[12px] text-[var(--status-offline)]">
                  请输入 http(s) 链接，保存后将回退默认接口
                </span>
              )}
            </label>
          </div>
          <label className="flex min-w-0 flex-col gap-2">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              忽略计费节点
            </span>
            <textarea
              value={draftCostIgnoredText}
              onChange={(event) => setDraftCostIgnoredText(event.target.value)}
              placeholder="每行一个节点名称 / UUID，也可以用逗号分隔"
              className="surface-inset min-h-[112px] w-full resize-y px-3 py-2 text-[13px] outline-none"
            />
          </label>
        </div>
      </InstancePanel>

      <InstancePanel
        title="主页延迟检测"
        description={
          <>
            为每台 VPS 选择首页展示的 Ping 任务，支持多选 VPS 批量配置。卡片完整展示已选任务，并始终按配置顺序排列；聚合策略只影响汇总数值。
            {" "}
            如果当前还没有可用任务，请先前往
            {" "}
            <a href="/admin/ping" className="theme-manage-inline-link">
              后台 Ping 管理
            </a>
            {" "}
            创建任务，再回来完成绑定。
          </>
        }
        aside={
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {tasksLoading || clientsLoading ? "载入中" : `${sortedTasks.length} 个任务`}
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
            <p className="text-xs text-[var(--text-secondary)]">按 VPS 勾选需要展示的任务，使用上下箭头调整卡片顺序。修改后点击页面顶部保存设置。</p>
            <div className="surface-inset flex items-center justify-between gap-3 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              <span>首页绑定</span>
              <strong className="text-[var(--text-primary)]">
                {boundClientCount} 节点 · {bindingPairCount} 关系
              </strong>
            </div>
          </div>

          {stalePingTaskIds.length > 0 && (
            <div className="theme-manage-diagnostics" role="status">
              <div className="theme-manage-diagnostics-head">
                <strong>已忽略已删除的 Ping 任务</strong>
                <span>{stalePingTaskIds.length} 项</span>
              </div>
              <div className="theme-manage-diagnostics-list">
                <div className="theme-manage-diagnostic-item">
                  <span>任务 ID {stalePingTaskIds.join("、")}</span>
                  <p>首页不会再展示这些任务的延迟或丢包；点击页面顶部“保存设置”即可永久清理其绑定、主任务和展示分组。</p>
                </div>
              </div>
            </div>
          )}

          <details className="surface-inset p-3">
            <summary className="cursor-pointer text-xs text-[var(--text-secondary)]">汇总策略、主任务与展示分组（可选，不影响卡片任务顺序）</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            <div className="surface-inset px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                    聚合策略
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    {activeAggregationOption.description}
                  </div>
                </div>
                <span className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]">
                  {activeAggregationOption.label}
                </span>
              </div>
              <div className="instance-segmented is-scrollable mt-3">
                {PING_AGGREGATION_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    data-active={draftPingAggregationStrategy === option.value ? "true" : "false"}
                    aria-pressed={draftPingAggregationStrategy === option.value}
                    onClick={() => setDraftPingAggregationStrategy(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="surface-inset px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold text-[var(--text-primary)]">
                    VPS 主任务
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-tertiary)]">
                    选择“主任务优先”时优先显示这里指定的任务；没有主任务或主任务无样本时回退风险优先。
                  </div>
                </div>
                <span className="text-[11px] text-[var(--text-tertiary)]">
                  {pingClientBindingRows.length} 台已配置
                </span>
              </div>
              {pingClientBindingRows.length === 0 ? (
                <div className="mt-3 rounded-[10px] border border-[var(--hairline)] px-3 py-2 text-[12px] text-[var(--text-tertiary)]">
                  暂无已绑定首页 Ping 的 VPS。
                </div>
              ) : (
                <div className="mt-3 grid max-h-[260px] gap-2 overflow-auto pr-1">
                  {pingClientBindingRows.map((row) => (
                    <div
                      key={row.uuid}
                      className="rounded-[12px] border border-[var(--hairline)] px-3 py-2"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">
                            {row.name}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-[var(--text-tertiary)]">
                            {row.group || row.region || row.uuid}
                          </span>
                        </span>
                        <select
                          value={row.primaryTaskId ?? ""}
                          onChange={(event) => {
                            const value = Number(event.target.value);
                            setPrimaryPingTask(row.uuid, Number.isInteger(value) && value > 0 ? value : null);
                          }}
                          className="surface-inset max-w-[180px] px-2 py-1.5 text-[12px] outline-none"
                          aria-label={`设置 ${row.name} 的首页 Ping 主任务`}
                        >
                          <option value="">自动</option>
                          {row.tasks.map((task) => (
                            <option key={task.taskId} value={task.taskId}>
                              {task.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {row.tasks.map((task) => (
                          <span
                            key={task.taskId}
                            className="rounded-full border border-[var(--hairline)] px-2 py-0.5 text-[10px] text-[var(--text-tertiary)]"
                          >
                            {task.group ? `${task.group} / ` : ""}
                            {task.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

            <div className="mt-3 flex flex-wrap gap-2">{sortedTasks.map((task) => <label key={task.id} className="surface-inset flex items-center gap-2 p-2 text-xs">
              {task.name || `任务 #${task.id}`}
              <input aria-label={`设置 ${task.name} 的展示分组`} className="min-w-0 bg-transparent outline-none" placeholder="展示分组（可选）" value={draftPingTaskGroups[task.id] ?? ""} onChange={(event) => setDraftPingTaskGroups((prev) => ({ ...prev, [task.id]: event.target.value }))} />
            </label>)}</div>
          </details>

          {pingDiagnostics.length > 0 && (
            <div className="theme-manage-diagnostics" role="alert">
              <div className="theme-manage-diagnostics-head">
                <strong>Ping 诊断</strong>
                <span>{pingDiagnostics.length} 项</span>
              </div>
              <div className="theme-manage-diagnostics-list">
                {pingDiagnostics.slice(0, 6).map((diagnostic) => (
                  <div
                    key={`${diagnostic.kind}-${diagnostic.taskId}-${diagnostic.clientUuid}`}
                    className="theme-manage-diagnostic-item"
                  >
                    <span>{diagnostic.title}</span>
                    <p>{diagnostic.detail}</p>
                  </div>
                ))}
                {pingDiagnostics.length > 6 && (
                  <div className="theme-manage-diagnostic-item">
                    <span>还有 {pingDiagnostics.length - 6} 项</span>
                    <p>可通过搜索任务或节点逐项检查。</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {(tasksLoading || clientsLoading) && (
            <div className="flex min-h-[20vh] items-center justify-center">
              <Spinner size={24} />
            </div>
          )}

          {noTasksYet && (
            <div className="theme-manage-empty-state">
              <span>当前还没有可用于首页展示的 Ping 任务。</span>
              <a href="/admin/ping" className="theme-manage-inline-link">
                前往后台 Ping 管理创建任务
              </a>
            </div>
          )}

          {!tasksLoading && !clientsLoading && <HomepagePingEditor clients={sortedClients} tasks={sortedTasks} bindings={prunedDraftBindings} order={draftPingTaskOrder} onChange={(bindings, order) => { setDraftBindings(bindings); setDraftPingTaskOrder(order); }} />}
        </div>
      </InstancePanel>
    </div>
  );
}
