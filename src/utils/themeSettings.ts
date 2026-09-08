import type { ThemeSettings } from "@/types/komari";
import {
  DEFAULT_BACKGROUND_ALIGNMENT,
  DEFAULT_SURFACE_OPACITY,
  normalizeBackgroundAlignment,
  normalizeBackgroundUrl,
  normalizeSurfaceOpacity,
} from "@/utils/background";
import { DEFAULT_COST_RATE_API_URL, normalizeCostIgnoredNodes, normalizeCostRateApiUrl } from "@/utils/cost";
import { normalizeHomeGroupOrder } from "@/utils/homeNodes";
import {
  DEFAULT_HOME_FACET_DIMENSIONS,
  normalizeHomeDefaultFacetDimension,
  normalizeHomeDefaultSavedViewId,
  normalizeHomeFacetDimensions,
  normalizeHomeNodeFacets,
  normalizeHomeSavedViews,
  normalizeHomeSelectedNodeUuids,
  type HomeFacetDimension,
  type HomeNodeFacets,
  type HomeSavedView,
} from "@/utils/homeVpsViews";
import {
  DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY,
  normalizeHomepagePingAggregationStrategy,
  normalizeHomepagePingPrimaryTasks,
  normalizeHomepagePingTaskGroups,
  type HomepagePingAggregationStrategy,
  type HomepagePingPrimaryTasks,
  type HomepagePingTaskGroups,
} from "@/utils/homepagePingSettings";
import {
  isOverviewRatingStyle,
  type OverviewRatingStyle,
} from "@/utils/overviewRating";
import { normalizeHomepagePingTaskBindings, normalizeHomepagePingTaskOrder, type HomepagePingTaskBindings, type HomepagePingTaskOrder } from "@/utils/pingTasks";
import {
  SYSTEM_DISPLAY_TIME_ZONE,
  normalizeDisplayTimeZone,
  type DisplayTimeZone,
} from "@/utils/timeDisplay";

export type Appearance = "system" | "light" | "dark";
export type NodeViewMode = "large" | "compact" | "list";

export interface ResolvedThemeSettings {
  defaultAppearance: Appearance;
  displayTimeZone: DisplayTimeZone;
  desktopNodeViewMode: NodeViewMode;
  mobileNodeViewMode: NodeViewMode;
  enableAdminButton: boolean;
  showPingChart: boolean;
  homepagePingBindings: HomepagePingTaskBindings;
  homepagePingTaskOrder: HomepagePingTaskOrder;
  homepagePingAggregationStrategy: HomepagePingAggregationStrategy;
  homepagePingPrimaryTasks: HomepagePingPrimaryTasks;
  homepagePingTaskGroups: HomepagePingTaskGroups;
  showHomeOverview: boolean;
  showGroupTabs: boolean;
  homeGroupOrder: string[];
  homeFacetDimensions: HomeFacetDimension[];
  homeNodeFacets: HomeNodeFacets;
  homeDefaultFacetDimension: string;
  homeSelectedNodeUuids: string[];
  homeSavedViews: HomeSavedView[];
  homeDefaultSavedViewId: string;
  moveOfflineNodesBack: boolean;
  showCostSummary: boolean;
  showCostSummaryFloatingButton: boolean;
  showOverviewRatings: boolean;
  overviewRatingStyle: OverviewRatingStyle;
  showTrafficRating: boolean;
  showBandwidthRating: boolean;
  showAssetRating: boolean;
  trafficRatingLabels: string;
  bandwidthRatingLabels: string;
  assetRatingLabels: string;
  compactShowTrafficTotal: boolean;
  compactShowBilling: boolean;
  compactShowUptime: boolean;
  showConnections: boolean;
  costIgnoredNodes: string[];
  costRateApiUrl: string;
  backgroundImage: string;
  backgroundImageMobile: string;
  backgroundAlignment: string;
  surfaceOpacity: number;
}

export const DEFAULT_THEME_SETTINGS: ResolvedThemeSettings = {
  defaultAppearance: "system",
  displayTimeZone: SYSTEM_DISPLAY_TIME_ZONE,
  desktopNodeViewMode: "compact",
  mobileNodeViewMode: "compact",
  enableAdminButton: true,
  showPingChart: true,
  homepagePingBindings: {},
  homepagePingTaskOrder: {},
  homepagePingAggregationStrategy: DEFAULT_HOMEPAGE_PING_AGGREGATION_STRATEGY,
  homepagePingPrimaryTasks: {},
  homepagePingTaskGroups: {},
  showHomeOverview: true,
  showGroupTabs: true,
  homeGroupOrder: [],
  homeFacetDimensions: DEFAULT_HOME_FACET_DIMENSIONS,
  homeNodeFacets: {},
  homeDefaultFacetDimension: "legacyGroup",
  homeSelectedNodeUuids: [],
  homeSavedViews: [],
  homeDefaultSavedViewId: "",
  moveOfflineNodesBack: true,
  showCostSummary: true,
  showCostSummaryFloatingButton: true,
  showOverviewRatings: true,
  overviewRatingStyle: "plain",
  showTrafficRating: true,
  showBandwidthRating: true,
  showAssetRating: true,
  trafficRatingLabels: "",
  bandwidthRatingLabels: "",
  assetRatingLabels: "",
  compactShowTrafficTotal: true,
  compactShowBilling: true,
  compactShowUptime: true,
  showConnections: false,
  costIgnoredNodes: [],
  costRateApiUrl: DEFAULT_COST_RATE_API_URL,
  backgroundImage: "",
  backgroundImageMobile: "",
  backgroundAlignment: DEFAULT_BACKGROUND_ALIGNMENT,
  surfaceOpacity: DEFAULT_SURFACE_OPACITY,
};

export function isAppearance(value: unknown): value is Appearance {
  return value === "system" || value === "light" || value === "dark";
}

function normalizeAppearance(
  value: unknown,
  fallback: Appearance = DEFAULT_THEME_SETTINGS.defaultAppearance,
): Appearance {
  return isAppearance(value) ? value : fallback;
}

export function isNodeViewMode(value: unknown): value is NodeViewMode {
  return value === "large" || value === "compact" || value === "list";
}

function normalizeNodeViewMode(
  value: unknown,
  fallback: NodeViewMode,
): NodeViewMode {
  return isNodeViewMode(value) ? value : fallback;
}

function enabledUnlessFalse(value: unknown) {
  return value !== false;
}

function normalizePlainText(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function normalizeThemeSettings(
  settings: (ThemeSettings & Record<string, unknown>) | null | undefined,
): ResolvedThemeSettings {
  const homepagePingBindings = normalizeHomepagePingTaskBindings(settings?.homepagePingBindings);
  const homeFacetDimensions = normalizeHomeFacetDimensions(settings?.homeFacetDimensions);
  const homeSavedViews = normalizeHomeSavedViews(settings?.homeSavedViews, homeFacetDimensions);

  return {
    defaultAppearance: normalizeAppearance(settings?.defaultAppearance),
    displayTimeZone: normalizeDisplayTimeZone(settings?.displayTimeZone),
    desktopNodeViewMode: normalizeNodeViewMode(
      settings?.desktopNodeViewMode,
      DEFAULT_THEME_SETTINGS.desktopNodeViewMode,
    ),
    mobileNodeViewMode: normalizeNodeViewMode(
      settings?.mobileNodeViewMode,
      DEFAULT_THEME_SETTINGS.mobileNodeViewMode,
    ),
    enableAdminButton: enabledUnlessFalse(settings?.enableAdminButton),
    showPingChart: enabledUnlessFalse(settings?.showPingChart),
    homepagePingBindings,
    homepagePingTaskOrder: normalizeHomepagePingTaskOrder(settings?.homepagePingTaskOrder, homepagePingBindings),
    homepagePingAggregationStrategy: normalizeHomepagePingAggregationStrategy(
      settings?.homepagePingAggregationStrategy,
    ),
    homepagePingPrimaryTasks: normalizeHomepagePingPrimaryTasks(
      settings?.homepagePingPrimaryTasks,
      homepagePingBindings,
    ),
    homepagePingTaskGroups: normalizeHomepagePingTaskGroups(settings?.homepagePingTaskGroups),
    showHomeOverview: enabledUnlessFalse(settings?.showHomeOverview),
    showGroupTabs: enabledUnlessFalse(settings?.showGroupTabs),
    homeGroupOrder: normalizeHomeGroupOrder(settings?.homeGroupOrder),
    homeFacetDimensions,
    homeNodeFacets: normalizeHomeNodeFacets(settings?.homeNodeFacets),
    homeDefaultFacetDimension: normalizeHomeDefaultFacetDimension(
      settings?.homeDefaultFacetDimension,
      homeFacetDimensions,
    ),
    homeSelectedNodeUuids: normalizeHomeSelectedNodeUuids(settings?.homeSelectedNodeUuids),
    homeSavedViews,
    homeDefaultSavedViewId: normalizeHomeDefaultSavedViewId(
      settings?.homeDefaultSavedViewId,
      homeSavedViews,
    ),
    moveOfflineNodesBack: enabledUnlessFalse(settings?.moveOfflineNodesBack),
    showCostSummary: enabledUnlessFalse(settings?.showCostSummary),
    showCostSummaryFloatingButton: enabledUnlessFalse(settings?.showCostSummaryFloatingButton),
    showOverviewRatings: enabledUnlessFalse(settings?.showOverviewRatings),
    overviewRatingStyle: isOverviewRatingStyle(settings?.overviewRatingStyle)
      ? settings.overviewRatingStyle
      : DEFAULT_THEME_SETTINGS.overviewRatingStyle,
    showTrafficRating: enabledUnlessFalse(settings?.showTrafficRating),
    showBandwidthRating: enabledUnlessFalse(settings?.showBandwidthRating),
    showAssetRating: enabledUnlessFalse(settings?.showAssetRating),
    trafficRatingLabels: normalizePlainText(settings?.trafficRatingLabels),
    bandwidthRatingLabels: normalizePlainText(settings?.bandwidthRatingLabels),
    assetRatingLabels: normalizePlainText(settings?.assetRatingLabels),
    compactShowTrafficTotal: enabledUnlessFalse(settings?.compactShowTrafficTotal),
    compactShowBilling: enabledUnlessFalse(settings?.compactShowBilling),
    compactShowUptime: enabledUnlessFalse(settings?.compactShowUptime),
    // 默认关闭(需手动开启):连接数是个小众指标,很多 agent 也不上报,所以只在显式启用时才显示。
    showConnections: settings?.showConnections === true,
    costIgnoredNodes: normalizeCostIgnoredNodes(settings?.costIgnoredNodes),
    costRateApiUrl: normalizeCostRateApiUrl(settings?.costRateApiUrl),
    backgroundImage: normalizeBackgroundUrl(settings?.backgroundImage),
    backgroundImageMobile: normalizeBackgroundUrl(settings?.backgroundImageMobile),
    backgroundAlignment: normalizeBackgroundAlignment(settings?.backgroundAlignment),
    surfaceOpacity: normalizeSurfaceOpacity(settings?.surfaceOpacity),
  };
}
