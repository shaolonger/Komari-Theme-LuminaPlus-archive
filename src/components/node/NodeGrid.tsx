import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpDown,
  BarChart3,
  Bookmark,
  Check,
  ChevronDown,
  CircleDollarSign,
  ListFilter,
  ListChecks,
  MoreHorizontal,
  Network,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useHomepagePingOverview, usePingMiniMap } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { useViewMode } from "@/hooks/useViewMode";
import { getAdminClients } from "@/services/api";
import type { HomeNodeSummary } from "@/services/wsStore";
import {
  formatBytes,
  formatByteRateLabel,
  resolveExpireTimestamp,
  trimFixed,
} from "@/utils/format";
import { formatRenewalPrice } from "@/utils/billing";
import { calculateCostSummary, formatCnyMoney, getExchangeRates } from "@/utils/cost";
import {
  HOME_ALL_GROUP,
  sortHomeGroupOptions,
  sortHomeNodeSummaries,
} from "@/utils/homeNodes";
import { fitFacetQuickOptionCount } from "@/utils/facetRailLayout";
import {
  HOME_FACET_LEGACY_GROUP,
  buildHomeFacetNode,
  filterHomeFacetNodes,
  getHomeFacetOptions,
  getHomeFacetSearchText,
  normalizeHomeFacetFilters,
  normalizeHomeSelectedNodeUuids,
  type HomeFacetDimension,
  type HomeFacetFilters,
  type HomeFacetNode,
} from "@/utils/homeVpsViews";
import {
  overlayAdminClientMeta,
  overlayConfiguredNodeMeta,
  shouldIncludeAgentVersionCompleteness,
} from "@/utils/nodeMetaOverlay";
import { invertHomepagePingTaskBindings } from "@/utils/pingTasks";
import type { VpsRisk, VpsRiskKind } from "@/utils/vpsRisk";
import {
  buildVpsWorkbenchNode,
  searchWorkbenchNode,
  sortWorkbenchNodes,
  summarizeWorkbench,
  type VpsWorkbenchNode,
  type WorkbenchSortKey,
} from "@/utils/vpsWorkbench";
import {
  DEFAULT_VPS_LIST_SORTS,
  sortVpsListNodes,
  toggleVpsListSort,
  type VpsListSortableNode,
  type VpsListSortCondition,
  type VpsListSortKey,
} from "@/utils/vpsListSort";
import { Spinner } from "@/components/ui/Spinner";
import { CompactNodeCard } from "./CompactNodeCard";
import { CostSummary } from "./CostSummary";
import { NodeCard } from "./NodeCard";
import { NodeList } from "./NodeList";
import { VpsListSortPanel } from "./VpsListSortPanel";

// 把多个 uuid 拼成单个签名串作为 memo key。逗号安全:uuid 是标准 UUID
// ([0-9a-f-]),永远不含逗号。
const UUID_KEY_SEPARATOR = ",";
const WORKBENCH_OPEN_STORAGE_KEY = "lumina-home-workbench-open";
const HOME_COMPARE_SEED_COUNT = 3;

interface HomeOverview {
  totalNodes: number;
  onlineNodes: number;
  offlineNodes: number;
  trafficUp: number;
  trafficDown: number;
  netUp: number;
  netDown: number;
}

type HomeRiskFilter = "all" | "attention" | VpsRiskKind;
type HomeRiskItem = VpsRisk & { name: string };

const WORKBENCH_SORT_OPTIONS: Array<{ value: WorkbenchSortKey; label: string }> = [
  { value: "weight", label: "默认排序" },
  { value: "risk", label: "风险优先" },
  { value: "expiry", label: "到期时间" },
  { value: "traffic", label: "流量压力" },
  { value: "completeness", label: "资料缺失" },
  { value: "name", label: "名称" },
];

const HOME_RISK_FILTERS: Array<{ value: HomeRiskFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "attention", label: "需处理" },
  { value: "status", label: "上报" },
  { value: "expiry", label: "到期" },
  { value: "traffic", label: "流量" },
  { value: "ping", label: "Ping" },
];

function countRiskNodes(risks: HomeRiskItem[], filter: HomeRiskFilter) {
  if (filter === "all") return 0;
  const uuids = new Set<string>();
  for (const risk of risks) {
    if (filter === "attention" || risk.kind === filter) {
      uuids.add(risk.uuid);
    }
  }
  return uuids.size;
}

function riskMatchesFilter(risks: HomeRiskItem[] | undefined, filter: HomeRiskFilter) {
  if (filter === "all") return true;
  if (!risks || risks.length === 0) return false;
  return filter === "attention" || risks.some((risk) => risk.kind === filter);
}

function readStoredWorkbenchOpen() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(WORKBENCH_OPEN_STORAGE_KEY) === "true";
}

function formatExpirePressure(node: VpsWorkbenchNode) {
  if (node.expireDays == null) return "到期未知";
  if (node.expireDays < 0) return "已过期";
  if (node.expireDays === 0) return "今日到期";
  return `${node.expireDays} 天后到期`;
}

function formatExhaustIn(seconds: number | null) {
  if (seconds == null) return "当前无明显消耗";
  if (seconds <= 0) return "已耗尽";
  const days = seconds / 86400;
  if (days >= 1) return `约 ${trimFixed(days, days >= 10 ? 0 : 1)} 天耗尽`;
  const hours = seconds / 3600;
  if (hours >= 1) return `约 ${trimFixed(hours, 1)} 小时耗尽`;
  return "不足 1 小时耗尽";
}

function WorkbenchCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "warning" | "critical" | "ok";
}) {
  return (
    <article className="home-workbench-card" data-tone={tone ?? "ok"}>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function HomeWorkbenchPanel({
  nodes,
  overview,
  risks,
  expanded,
  showOverview,
  costSummary,
  costLoading,
  showCostDetailButton,
  onOpenCostSummary,
  onToggle,
}: {
  nodes: VpsWorkbenchNode[];
  overview: HomeOverview;
  risks: HomeRiskItem[];
  expanded: boolean;
  showOverview: boolean;
  costSummary: { remainingCny: number } | null;
  costLoading: boolean;
  showCostDetailButton: boolean;
  onOpenCostSummary: () => void;
  onToggle: () => void;
}) {
  const summary = useMemo(() => summarizeWorkbench(nodes), [nodes]);
  const riskNodes = countRiskNodes(risks, "attention");
  const incompleteNodes = useMemo(
    () => sortWorkbenchNodes(nodes.filter((node) => node.completeness.ratio < 1), "completeness").slice(0, 3),
    [nodes],
  );
  const renewalNodes = useMemo(
    () =>
      sortWorkbenchNodes(
        nodes.filter((node) =>
          ["expired", "soon", "month"].includes(node.expiryBucket),
        ),
        "expiry",
      ).slice(0, 3),
    [nodes],
  );
  const trafficNodes = useMemo(
    () =>
      sortWorkbenchNodes(
        nodes.filter((node) =>
          ["warning", "critical", "exhausted"].includes(node.traffic.status),
        ),
        "traffic",
      ).slice(0, 3),
    [nodes],
  );
  const pingNodes = useMemo(
    () =>
      nodes
        .filter((node) =>
          ["disabled", "no-data", "warning", "critical"].includes(node.ping.state),
        )
        .slice(0, 3),
    [nodes],
  );

  return (
    <section className="home-workbench" aria-label="VPS 管理工作台" data-expanded={expanded ? "true" : "false"}>
      <div className="home-fleet-strip">
        <div className="home-fleet-metrics" aria-label="舰队状态摘要">
          <span>
            在线
            <strong>{overview.onlineNodes}/{overview.totalNodes}</strong>
          </span>
          {showOverview && (
            <>
              <span title={`↑ ${formatBytes(overview.trafficUp)} · ↓ ${formatBytes(overview.trafficDown)}`}>
                累计流量
                <strong>{formatBytes(overview.trafficUp + overview.trafficDown)}</strong>
              </span>
              <span title={`↑ ${formatByteRateLabel(overview.netUp)} · ↓ ${formatByteRateLabel(overview.netDown)}`}>
                实时带宽
                <strong>{formatByteRateLabel(overview.netUp + overview.netDown)}</strong>
              </span>
            </>
          )}
          <span data-tone={riskNodes > 0 ? "warning" : "ok"}>
            待处理
            <strong>{riskNodes}</strong>
          </span>
          <span data-tone={summary.expired > 0 || summary.dueSoon > 0 ? "warning" : "ok"}>
            30 天到期
            <strong>{summary.dueMonth + summary.dueSoon + summary.expired}</strong>
          </span>
          <span data-tone={summary.trafficPressure > 0 ? "warning" : "ok"}>
            流量压力
            <strong>{summary.trafficPressure}</strong>
          </span>
          <span data-tone={summary.incomplete > 0 ? "warning" : "ok"}>
            资料待补
            <strong>{summary.incomplete}</strong>
          </span>
          {showOverview && (
            <button
              type="button"
              className="home-fleet-metric"
              disabled={!showCostDetailButton}
              onClick={showCostDetailButton ? onOpenCostSummary : undefined}
              title={showCostDetailButton ? "打开资产统计" : "资产统计未启用"}
            >
              <span>资产</span>
              <strong>
                {costSummary
                  ? formatCnyMoney(costSummary.remainingCny)
                  : costLoading
                    ? "计算中"
                    : "—"}
              </strong>
              {showCostDetailButton && <CircleDollarSign size={12} aria-hidden="true" />}
            </button>
          )}
        </div>
        <button
          type="button"
          className="home-fleet-toggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <ChevronDown size={16} aria-hidden="true" />
          <span>{expanded ? "收起" : "展开"}</span>
        </button>
      </div>
      {expanded && (
        <div className="home-workbench-details">
          <HomeOperationsQueue risks={risks} />
          <div className="home-workbench-grid">
            <WorkbenchCard
              label="资料完整度"
              value={`${summary.total - summary.incomplete}/${summary.total}`}
              detail={summary.incomplete > 0 ? `${summary.incomplete} 台缺少关键资料` : "资料已完整"}
              tone={summary.incomplete > 0 ? "warning" : "ok"}
            />
            <WorkbenchCard
              label="续费压力"
              value={`${summary.expired + summary.dueSoon}`}
              detail={`30 天内 ${summary.dueMonth} 台，已过期 ${summary.expired} 台`}
              tone={summary.expired > 0 ? "critical" : summary.dueSoon > 0 || summary.dueMonth > 0 ? "warning" : "ok"}
            />
            <WorkbenchCard
              label="流量压力"
              value={`${summary.trafficPressure}`}
              detail={summary.trafficPressure > 0 ? "存在临界或预计耗尽节点" : "暂无流量压力"}
              tone={summary.trafficPressure > 0 ? "warning" : "ok"}
            />
            <WorkbenchCard
              label="Ping 状态"
              value={`${summary.pingAttention}`}
              detail={summary.pingAttention > 0 ? "存在不可用或无数据绑定" : "Ping 覆盖正常"}
              tone={summary.pingAttention > 0 ? "warning" : "ok"}
            />
          </div>
          <div className="home-workbench-lists">
            <WorkbenchList
              title="资料待补"
              empty="关键资料完整"
              nodes={incompleteNodes}
              getDetail={(node) => node.completeness.missing.map((item) => item.label).slice(0, 3).join("、")}
            />
            <WorkbenchList
              title="续费关注"
              empty="近期无需续费"
              nodes={renewalNodes}
              getDetail={formatExpirePressure}
            />
            <WorkbenchList
              title="流量预估"
              empty="暂无流量压力"
              nodes={trafficNodes}
              getDetail={(node) => formatExhaustIn(node.traffic.exhaustInSeconds)}
            />
            <WorkbenchList
              title="Ping 关注"
              empty="Ping 状态正常"
              nodes={pingNodes}
              getDetail={(node) => node.ping.detail}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function WorkbenchList({
  title,
  empty,
  nodes,
  getDetail,
}: {
  title: string;
  empty: string;
  nodes: VpsWorkbenchNode[];
  getDetail: (node: VpsWorkbenchNode) => string;
}) {
  return (
    <section className="home-workbench-list">
      <h3>{title}</h3>
      {nodes.length > 0 ? (
        nodes.map((node) => (
          <Link key={node.uuid} to={`/instance/${node.uuid}`} title={node.name}>
            <span>{node.name}</span>
            <strong>{getDetail(node) || "—"}</strong>
          </Link>
        ))
      ) : (
        <p>{empty}</p>
      )}
    </section>
  );
}

function HomeOperationsQueue({
  risks,
}: {
  risks: HomeRiskItem[];
}) {
  const topRisks = risks.slice(0, 6);
  const riskNodes = countRiskNodes(risks, "attention");

  return (
    <section className="home-ops-panel" aria-label="VPS 运维事项">
      <div className="home-ops-head">
        <div>
          <h2>运维事项</h2>
          <p>{riskNodes > 0 ? `${riskNodes} 台 VPS 需要关注` : "当前没有高优先级事项"}</p>
        </div>
      </div>
      <div className="home-ops-list">
        {topRisks.length > 0 ? (
          topRisks.map((risk) => (
            <Link
              key={`${risk.uuid}-${risk.kind}-${risk.title}`}
              to={`/instance/${risk.uuid}`}
              className="home-ops-item"
              data-severity={risk.severity}
              title={`${risk.name}: ${risk.detail}`}
            >
              <span className="home-ops-node">{risk.name}</span>
              <span className="home-ops-title">{risk.title}</span>
              <span className="home-ops-detail">{risk.detail}</span>
            </Link>
          ))
        ) : (
          <div className="home-ops-empty">暂无需要处理的 VPS</div>
        )}
      </div>
    </section>
  );
}

function HomeRiskFilters({
  risks,
  selectedFilter,
  onSelectFilter,
}: {
  risks: HomeRiskItem[];
  selectedFilter: HomeRiskFilter;
  onSelectFilter: (filter: HomeRiskFilter) => void;
}) {
  return (
    <div className="home-risk-filter-strip" role="group" aria-label="运维事项筛选">
      {HOME_RISK_FILTERS.map((filter) => {
        const count = countRiskNodes(risks, filter.value);
        return (
          <button
            key={filter.value}
            type="button"
            data-zero={filter.value !== "all" && count === 0 ? "true" : "false"}
            data-active={selectedFilter === filter.value ? "true" : "false"}
            onClick={() => onSelectFilter(filter.value)}
          >
            <span>{filter.value === "all" ? "全部节点" : filter.label}</span>
            {filter.value !== "all" && <strong>{count}</strong>}
          </button>
        );
      })}
    </div>
  );
}

function clearFacetFilter(filters: HomeFacetFilters, dimensionId: string) {
  const next = { ...filters };
  delete next[dimensionId];
  return next;
}

function getDimensionLabel(dimensions: HomeFacetDimension[], id: string) {
  return dimensions.find((dimension) => dimension.id === id)?.label ?? id;
}

export function FacetRail({
  dimensions,
  dimensionCoverage,
  selectedDimension,
  options,
  optionCounts,
  selectedValues,
  activeFilterCount,
  onSelectValue,
}: {
  dimensions: HomeFacetDimension[];
  dimensionCoverage: Map<string, number>;
  selectedDimension: string;
  options: string[];
  optionCounts: Map<string, number>;
  selectedValues: string[];
  activeFilterCount: number;
  onSelectValue: (value: string) => void;
}) {
  const orderedOptions = useMemo(
    () => Array.from(new Set(options)),
    [options],
  );
  const [quickOptionCount, setQuickOptionCount] = useState(orderedOptions.length);
  const railRef = useRef<HTMLElement>(null);
  const dimensionRef = useRef<HTMLDivElement>(null);
  const noFilterRef = useRef<HTMLButtonElement>(null);
  const optionMeasureRef = useRef<HTMLDivElement>(null);
  const moreMeasureRef = useRef<HTMLDivElement>(null);
  const quickOptions = orderedOptions.slice(0, quickOptionCount);
  const overflowOptions = orderedOptions.slice(quickOptionCount);
  const dimensionLabel = getDimensionLabel(dimensions, selectedDimension);
  const measurementKey = [
    selectedDimension,
    activeFilterCount,
    ...dimensions.map(
      (dimension) =>
        `${dimension.id}:${dimension.label}:${dimensionCoverage.get(dimension.id) ?? 0}`,
    ),
    ...orderedOptions.map(
      (option) => `${option}:${optionCounts.get(option) ?? 0}`,
    ),
  ].join("|");

  useLayoutEffect(() => {
    const rail = railRef.current;
    const dimension = dimensionRef.current;
    const noFilter = noFilterRef.current;
    const optionMeasure = optionMeasureRef.current;
    const moreMeasure = moreMeasureRef.current;
    if (!rail || !dimension || !noFilter || !optionMeasure || !moreMeasure) return;

    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const style = window.getComputedStyle(rail);
      const contentWidth =
        rail.clientWidth -
        Number.parseFloat(style.paddingLeft || "0") -
        Number.parseFloat(style.paddingRight || "0");
      const optionStyle = window.getComputedStyle(optionMeasure);
      const nextCount = fitFacetQuickOptionCount({
        contentWidth,
        dimensionWidth: dimension.getBoundingClientRect().width,
        noFilterWidth: noFilter.getBoundingClientRect().width,
        railGap: Number.parseFloat(style.columnGap || style.gap || "0"),
        optionGap: Number.parseFloat(
          optionStyle.columnGap || optionStyle.gap || "0",
        ),
        optionWidths: Array.from(
          optionMeasure.querySelectorAll<HTMLElement>(
            "[data-facet-measure-option]",
          ),
          (element) => element.getBoundingClientRect().width,
        ),
        moreWidths: Array.from(
          moreMeasure.querySelectorAll<HTMLElement>(
            "[data-facet-measure-more]",
          ),
          (element) => element.getBoundingClientRect().width,
        ),
      });
      setQuickOptionCount((current) =>
        current === nextCount ? current : nextCount,
      );
    };

    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(rail);
    void document.fonts?.ready.then(measure);

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [measurementKey]);

  const renderOption = (option: string, location: "quick" | "more") => (
    <button
      key={`${location}-${option}`}
      className="home-facet-option"
      type="button"
      role="option"
      aria-selected={selectedValues.includes(option)}
      data-active={selectedValues.includes(option) ? "true" : "false"}
      onClick={() => onSelectValue(option)}
      title={`${dimensionLabel}：${option}`}
    >
      <span>{option}</span>
      <small>{optionCounts.get(option) ?? 0}</small>
    </button>
  );

  return (
    <section
      ref={railRef}
      className="home-facet-rail"
      aria-label={`${dimensionLabel}分类筛选`}
      data-overflow={overflowOptions.length > 0 ? "true" : "false"}
    >
      <div ref={dimensionRef} className="home-facet-dimension-select">
        <SlidersHorizontal size={13} aria-hidden="true" />
        <span>{dimensionLabel}</span>
        {activeFilterCount > 0 && <strong>{activeFilterCount}</strong>}
      </div>
      <div
        className="home-facet-options"
        role="listbox"
        aria-label={`${dimensionLabel}筛选`}
      >
        <button
          ref={noFilterRef}
          className="home-facet-option"
          type="button"
          role="option"
          aria-selected={selectedValues.length === 0}
          data-active={selectedValues.length === 0 ? "true" : "false"}
          onClick={() => onSelectValue(HOME_ALL_GROUP)}
        >
          <span>不限</span>
          <small>{optionCounts.get(HOME_ALL_GROUP) ?? 0}</small>
        </button>
        {quickOptions.map((option) => renderOption(option, "quick"))}
        {options.length === 0 && (
          <span className="home-facet-empty" role="status">
            {(optionCounts.get(HOME_ALL_GROUP) ?? 0) > 0
              ? `当前节点尚未配置${dimensionLabel}`
              : "当前筛选下无节点"}
          </span>
        )}
      </div>
      {overflowOptions.length > 0 && (
        <details className="home-facet-more">
          <summary
            className="home-facet-more-control"
            title={`查看其余 ${overflowOptions.length} 个${dimensionLabel}`}
          >
            <MoreHorizontal size={13} aria-hidden="true" />
            <span>更多</span>
            <strong>+{overflowOptions.length}</strong>
          </summary>
          <div className="home-facet-more-popover" role="listbox">
            <header>
              <span>更多{dimensionLabel}</span>
              <small>{orderedOptions.length} 项</small>
            </header>
            {overflowOptions.map((option) => renderOption(option, "more"))}
          </div>
        </details>
      )}
      <div
        ref={optionMeasureRef}
        className="home-facet-measure home-facet-option-measure"
        aria-hidden="true"
      >
        {orderedOptions.map((option) => (
          <span
            key={`measure-${option}`}
            className="home-facet-option"
            data-facet-measure-option
          >
            <span>{option}</span>
            <small>{optionCounts.get(option) ?? 0}</small>
          </span>
        ))}
      </div>
      <div
        ref={moreMeasureRef}
        className="home-facet-measure home-facet-more-measure"
        aria-hidden="true"
      >
        {orderedOptions.map((_, index) => (
          <span
            key={`measure-more-${index + 1}`}
            className="home-facet-more-control"
            data-facet-measure-more
          >
            <MoreHorizontal size={13} aria-hidden="true" />
            <span>更多</span>
            <strong>+{index + 1}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

function NodeSelectionPanel({
  nodes,
  selectedUuids,
  searchTextByUuid,
  search,
  onSearch,
  onToggleNode,
  onSelectMany,
  onClear,
  onClose,
}: {
  nodes: VpsWorkbenchNode[];
  selectedUuids: string[];
  searchTextByUuid: Map<string, string>;
  search: string;
  onSearch: (value: string) => void;
  onToggleNode: (uuid: string, checked: boolean) => void;
  onSelectMany: (uuids: string[]) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const selected = new Set(selectedUuids);
  const keyword = search.trim().toLowerCase();
  const visibleNodes = keyword
    ? nodes.filter((node) => {
        const searchText = searchTextByUuid.get(node.uuid) ?? `${node.name} ${node.uuid}`.toLowerCase();
        return searchText.includes(keyword);
      })
    : nodes;
  const allVisibleSelected =
    visibleNodes.length > 0 && visibleNodes.every((node) => selected.has(node.uuid));

  return (
    <section className="home-node-select-panel" aria-label="指定展示 VPS">
      <div className="home-node-select-head">
        <div>
          <strong>指定展示 VPS</strong>
          <span>{selected.size > 0 ? `已选择 ${selected.size} 台` : "未指定时展示全部可见 VPS"}</span>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭 VPS 选择面板">
          <X size={15} />
        </button>
      </div>
      <div className="home-node-select-toolbar">
        <label className="home-workbench-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索 VPS、UUID、备注或标签"
            aria-label="搜索可选择 VPS"
          />
        </label>
        <button
          type="button"
          disabled={visibleNodes.length === 0 || allVisibleSelected}
          onClick={() => onSelectMany(visibleNodes.map((node) => node.uuid))}
        >
          <Check size={14} aria-hidden="true" />
          {allVisibleSelected ? "已全选当前结果" : "全选当前结果"}
        </button>
        <button type="button" disabled={selected.size === 0} onClick={onClear}>
          <X size={14} aria-hidden="true" />
          清空
        </button>
      </div>
      <div className="home-node-select-list">
        {visibleNodes.map((node) => (
          <label key={node.uuid} className="home-node-select-item">
            <input
              type="checkbox"
              checked={selected.has(node.uuid)}
              onChange={(event) => onToggleNode(node.uuid, event.target.checked)}
            />
            <span className="home-node-select-main">
              <span>
                {node.name}
                {node.riskSeverity !== "none" && <em data-risk={node.riskSeverity}>需关注</em>}
              </span>
              <small>
                {[node.group, node.region, node.uuid].filter(Boolean).join(" · ") || node.uuid}
              </small>
            </span>
          </label>
        ))}
        {visibleNodes.length === 0 && (
          <div className="home-filter-empty">当前搜索下没有可选择的 VPS</div>
        )}
      </div>
    </section>
  );
}

export function NodeGrid() {
  const nodes = useHomeNodeSummaries();
  const allMeta = useAllNodeMeta();
  const { data: me } = useAuth();
  const themeSettings = useThemeSettings();
  const { mode } = useViewMode();
  const [selectedFacetDimension, setSelectedFacetDimension] = useState(HOME_FACET_LEGACY_GROUP);
  const [facetFilters, setFacetFilters] = useState<HomeFacetFilters>({});
  const [selectedNodeUuids, setSelectedNodeUuids] = useState<string[]>([]);
  const [nodeSelectorOpen, setNodeSelectorOpen] = useState(false);
  const [nodeSelectorSearch, setNodeSelectorSearch] = useState("");
  const [activeSavedViewId, setActiveSavedViewId] = useState("");
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<HomeRiskFilter>("all");
  const [nodeSearch, setNodeSearch] = useState("");
  const [workbenchSort, setWorkbenchSort] = useState<WorkbenchSortKey>("weight");
  const [listSorts, setListSorts] = useState<VpsListSortCondition[]>(() =>
    DEFAULT_VPS_LIST_SORTS.map((condition) => ({ ...condition })),
  );
  const [listSortPanelOpen, setListSortPanelOpen] = useState(false);
  const [listInteractionActive, setListInteractionActive] = useState(false);
  const frozenListOrderRef = useRef("");
  const [workbenchOpen, setWorkbenchOpen] = useState(readStoredWorkbenchOpen);
  const [costSummaryOpen, setCostSummaryOpen] = useState(false);
  const seededHomeViewRef = useRef(false);
  useHomepagePingOverview();
  const adminClientsQuery = useQuery({
    queryKey: ["admin-clients"],
    queryFn: getAdminClients,
    enabled: me?.logged_in === true,
    staleTime: 30_000,
    retry: 1,
  });

  const visibleNodes = useMemo(
    () => nodes.filter((node) => me?.logged_in === true || !node.hidden),
    [me?.logged_in, nodes],
  );
  const visibleNodeUuids = useMemo(
    () => visibleNodes.map((node) => node.uuid),
    [visibleNodes],
  );
  const pingByUuid = usePingMiniMap(visibleNodeUuids);
  const overview = useMemo<HomeOverview>(() => {
    let onlineNodes = 0;
    let offlineNodes = 0;
    let trafficUp = 0;
    let trafficDown = 0;
    let netUp = 0;
    let netDown = 0;
    for (const node of visibleNodes) {
      if (node.online === true) onlineNodes += 1;
      else if (node.online === false) offlineNodes += 1;
      trafficUp += node.trafficUp;
      trafficDown += node.trafficDown;
      netUp += node.netUp;
      netDown += node.netDown;
    }

    return {
      totalNodes: visibleNodes.length,
      onlineNodes,
      offlineNodes,
      trafficUp,
      trafficDown,
      netUp,
      netDown,
    };
  }, [visibleNodes]);
  const adminClientByUuid = useMemo(
    () => new Map((adminClientsQuery.data ?? []).map((node) => [node.uuid, node])),
    [adminClientsQuery.data],
  );
  const hasAdminMetadata =
    me?.logged_in === true && adminClientsQuery.isSuccess;
  const workbenchMetaByUuid = useMemo(
    () =>
      new Map(
        allMeta.map((node) => [
          node.uuid,
          overlayAdminClientMeta(
            overlayConfiguredNodeMeta(node, themeSettings.homeNodeFacets),
            adminClientByUuid.get(node.uuid),
          ),
        ]),
      ),
    [adminClientByUuid, allMeta, themeSettings.homeNodeFacets],
  );
  const includeAgentVersion = shouldIncludeAgentVersionCompleteness({
    loggedIn: me?.logged_in === true,
    adminMetadataReady: hasAdminMetadata,
  });
  const selectedPingTaskByClient = useMemo(
    () =>
      themeSettings.isReady
        ? invertHomepagePingTaskBindings(themeSettings.homepagePingBindings)
        : new Map<string, number>(),
    [themeSettings.homepagePingBindings, themeSettings.isReady],
  );
  const workbenchNodesByUuid = useMemo(() => {
    const next = new Map<string, VpsWorkbenchNode>();
    for (const node of visibleNodes) {
      const meta = workbenchMetaByUuid.get(node.uuid);
      if (!meta) continue;
      next.set(
        node.uuid,
        buildVpsWorkbenchNode({
          meta,
          online: node.online,
          updatedAt: node.updatedAt,
          trafficUp: node.trafficUp,
          trafficDown: node.trafficDown,
          netUp: node.netUp,
          netDown: node.netDown,
          hasPingBinding: selectedPingTaskByClient.has(node.uuid),
          includeAgentVersion,
          ping: pingByUuid.get(node.uuid),
        }),
      );
    }
    return next;
  }, [includeAgentVersion, pingByUuid, selectedPingTaskByClient, visibleNodes, workbenchMetaByUuid]);
  const workbenchNodes = useMemo(
    () => Array.from(workbenchNodesByUuid.values()),
    [workbenchNodesByUuid],
  );
  const visibleFacetDimensions = useMemo(
    () => themeSettings.homeFacetDimensions.filter((dimension) => dimension.visible),
    [themeSettings.homeFacetDimensions],
  );
  const facetNodes = useMemo<HomeFacetNode[]>(
    () =>
      visibleNodes.map((node) => {
        const meta = workbenchMetaByUuid.get(node.uuid);
        return buildHomeFacetNode(
          meta ?? {
            uuid: node.uuid,
            name: node.uuid,
            group: node.group,
            region: node.region,
            tags: "",
            provider: "",
            business_role: "",
            public_remark: "",
          },
          themeSettings.homeNodeFacets,
        );
      }),
    [themeSettings.homeNodeFacets, visibleNodes, workbenchMetaByUuid],
  );
  const facetNodeByUuid = useMemo(
    () => new Map(facetNodes.map((node) => [node.uuid, node])),
    [facetNodes],
  );
  const facetSearchTextByUuid = useMemo(() => {
    const next = new Map<string, string>();
    for (const node of visibleNodes) {
      const facetNode = facetNodeByUuid.get(node.uuid);
      const meta = workbenchMetaByUuid.get(node.uuid);
      if (!facetNode) continue;
      next.set(
        node.uuid,
        getHomeFacetSearchText(
          meta ?? {
            uuid: node.uuid,
            name: node.uuid,
            group: node.group,
            region: node.region,
            tags: "",
            provider: "",
            business_role: "",
            public_remark: "",
          },
          facetNode.facets,
        ),
      );
    }
    return next;
  }, [facetNodeByUuid, visibleNodes, workbenchMetaByUuid]);
  const risksByUuid = useMemo(() => {
    const next = new Map<string, HomeRiskItem[]>();
    for (const node of workbenchNodesByUuid.values()) {
      const risks = node.risks.map((risk) => ({
        ...risk,
        name: node.name,
      }));
      if (risks.length > 0) {
        next.set(node.uuid, risks);
      }
    }
    return next;
  }, [workbenchNodesByUuid]);
  const operationRisks = useMemo(
    () =>
      Array.from(risksByUuid.values())
        .flat()
        .sort((left, right) => {
          const severityDelta =
            (right.severity === "critical" ? 1 : 0) -
            (left.severity === "critical" ? 1 : 0);
          if (severityDelta !== 0) return severityDelta;
          return left.name.localeCompare(right.name, "zh-CN");
        }),
    [risksByUuid],
  );
  const showHomeOverview = themeSettings.isReady && themeSettings.showHomeOverview;
  const hasNodes = allMeta.length > 0;
  // 资产概览卡片(剩余价值)始终显示,这样切换花费相关设置不会让整行重排。
  // showCostSummary 控制卡片右上角的详情按钮;悬浮球是兜底入口,只在详情按钮
  // 不显示时出现(总览隐藏或其开关关闭),所以两个入口不会同时出现(都开时卡内
  // 详情按钮优先)。
  const showAssetCard = showHomeOverview && hasNodes;
  const showCostDetailButton =
    showAssetCard && themeSettings.isReady && themeSettings.showCostSummary;
  const showCostFloatingButton =
    themeSettings.isReady &&
    themeSettings.showCostSummaryFloatingButton &&
    hasNodes &&
    !showCostDetailButton;
  // 只要有东西用到花费就计算:常驻的资产卡片,或悬浮球/面板。面板只在能被打开时才挂载。
  const costNeeded = showAssetCard || showCostFloatingButton;
  const shouldRenderCostSummary = showCostDetailButton || showCostFloatingButton;
  const rateQuery = useQuery({
    queryKey: ["cost-rates", themeSettings.costRateApiUrl],
    queryFn: () => getExchangeRates(themeSettings.costRateApiUrl),
    staleTime: 60 * 60 * 1000,
    enabled: costNeeded,
    retry: 1,
  });
  const costSummary = useMemo(
    () =>
      rateQuery.data
        ? calculateCostSummary(allMeta, themeSettings.costIgnoredNodes, rateQuery.data.rates)
        : null,
    [allMeta, themeSettings.costIgnoredNodes, rateQuery.data],
  );
  const costLoading = costNeeded && rateQuery.isLoading;
  useEffect(() => {
    if (!shouldRenderCostSummary && costSummaryOpen) setCostSummaryOpen(false);
  }, [shouldRenderCostSummary, costSummaryOpen]);
  useEffect(() => {
    window.localStorage.setItem(WORKBENCH_OPEN_STORAGE_KEY, String(workbenchOpen));
  }, [workbenchOpen]);
  const applySavedView = useCallback(
    (viewId: string) => {
      const view = themeSettings.homeSavedViews.find((item) => item.id === viewId);
      if (!view) {
        setActiveSavedViewId("");
        return;
      }
      setActiveSavedViewId(view.id);
      setSelectedNodeUuids(view.selectedNodeUuids);
      setFacetFilters(normalizeHomeFacetFilters(view.filters));
      setSelectedFacetDimension(view.groupBy);
      if (WORKBENCH_SORT_OPTIONS.some((option) => option.value === view.sortKey)) {
        setWorkbenchSort(view.sortKey as WorkbenchSortKey);
      }
      setListSorts(view.sorts.map((condition) => ({ ...condition })));
    },
    [themeSettings.homeSavedViews],
  );
  useEffect(() => {
    if (!themeSettings.isReady || seededHomeViewRef.current) return;
    seededHomeViewRef.current = true;
    if (themeSettings.homeDefaultSavedViewId) {
      applySavedView(themeSettings.homeDefaultSavedViewId);
      return;
    }
    setSelectedNodeUuids(themeSettings.homeSelectedNodeUuids);
    setSelectedFacetDimension(themeSettings.homeDefaultFacetDimension);
  }, [
    applySavedView,
    themeSettings.homeDefaultFacetDimension,
    themeSettings.homeDefaultSavedViewId,
    themeSettings.homeSelectedNodeUuids,
    themeSettings.isReady,
  ]);
  const visibleNodeUuidSet = useMemo(
    () => new Set(visibleNodes.map((node) => node.uuid)),
    [visibleNodes],
  );
  useEffect(() => {
    setSelectedNodeUuids((prev) => prev.filter((uuid) => visibleNodeUuidSet.has(uuid)));
  }, [visibleNodeUuidSet]);
  useEffect(() => {
    if (visibleFacetDimensions.length === 0) return;
    if (!visibleFacetDimensions.some((dimension) => dimension.id === selectedFacetDimension)) {
      setSelectedFacetDimension(themeSettings.homeDefaultFacetDimension);
    }
  }, [
    selectedFacetDimension,
    themeSettings.homeDefaultFacetDimension,
    visibleFacetDimensions,
  ]);
  const [shownDimensions, setShownDimensions] = useState<string[] | null>(null);
  const enabledDimensions = visibleFacetDimensions.filter((dimension) =>
    (shownDimensions ?? [selectedFacetDimension, "region"]).includes(dimension.id) || (facetFilters[dimension.id]?.length ?? 0) > 0,
  );
  const facetRows = useMemo(() => visibleFacetDimensions.map((dimension) => {
    const candidates = filterHomeFacetNodes({ nodes: facetNodes, filters: clearFacetFilter(facetFilters, dimension.id), selectedNodeUuids });
    const allOptions = getHomeFacetOptions(facetNodes, dimension.id);
    const counts = new Map<string, number>([[HOME_ALL_GROUP, candidates.length]]);
    for (const node of candidates) for (const value of node.facets[dimension.id] ?? []) counts.set(value, (counts.get(value) ?? 0) + 1);
    return { dimension, options: dimension.id === HOME_FACET_LEGACY_GROUP ? sortHomeGroupOptions(allOptions, themeSettings.homeGroupOrder) : allOptions, counts };
  }), [visibleFacetDimensions, facetNodes, facetFilters, selectedNodeUuids, themeSettings.homeGroupOrder]);
  const facetDimensionCoverage = useMemo(() => {
    const coverage = new Map<string, number>();
    for (const dimension of visibleFacetDimensions) {
      const candidates = filterHomeFacetNodes({
        nodes: facetNodes,
        filters: clearFacetFilter(facetFilters, dimension.id),
        selectedNodeUuids,
      });
      coverage.set(
        dimension.id,
        candidates.filter((node) => (node.facets[dimension.id] ?? []).length > 0).length,
      );
    }
    return coverage;
  }, [facetFilters, facetNodes, selectedNodeUuids, visibleFacetDimensions]);
  const activeFacetFilterCount = useMemo(
    () =>
      Object.values(facetFilters).reduce(
        (total, values) => total + values.length,
        0,
      ),
    [facetFilters],
  );
  const facetFilteredUuidSet = useMemo(
    () =>
      new Set(
        filterHomeFacetNodes({
          nodes: facetNodes,
          filters: facetFilters,
          selectedNodeUuids,
        }).map((node) => node.uuid),
      ),
    [facetFilters, facetNodes, selectedNodeUuids],
  );
  const filteredNodes = useMemo(() => {
    const facetFiltered = visibleNodes.filter((node) => facetFilteredUuidSet.has(node.uuid));
    const normalizedSearch = nodeSearch.trim().toLowerCase();
    const searchFiltered = normalizedSearch
      ? facetFiltered.filter((node) => {
          const workbenchNode = workbenchNodesByUuid.get(node.uuid);
          const meta = workbenchMetaByUuid.get(node.uuid);
          if (workbenchNode && meta) {
            if (searchWorkbenchNode(workbenchNode, meta, normalizedSearch)) return true;
          }
          return (facetSearchTextByUuid.get(node.uuid) ?? node.uuid.toLowerCase()).includes(
            normalizedSearch,
          );
        })
      : facetFiltered;
    const riskFiltered =
      selectedRiskFilter === "all"
        ? searchFiltered
        : searchFiltered.filter((node) =>
            riskMatchesFilter(risksByUuid.get(node.uuid), selectedRiskFilter),
          );

    if (mode === "list") {
      const nodeByUuid = new Map(riskFiltered.map((node) => [node.uuid, node]));
      const sortableNodes = riskFiltered
        .map((node): VpsListSortableNode | null => {
          const meta = workbenchMetaByUuid.get(node.uuid);
          const workbenchNode = workbenchNodesByUuid.get(node.uuid);
          if (!meta || !workbenchNode) return null;
          const ping = pingByUuid.get(node.uuid);
          const hasTrafficLimit = meta.traffic_limit > 0;
          const priceLabel = formatRenewalPrice(meta);
          return {
            uuid: node.uuid,
            weight: node.weight,
            online: node.online,
            name: meta.name.trim() || node.uuid,
            group: String(meta.group ?? "").trim(),
            region: String(meta.region ?? "").trim(),
            provider: String(meta.provider ?? "").trim(),
            cpu: node.cpuPct,
            memory: node.ramPct,
            disk: node.diskPct,
            load: node.load1,
            upload: node.netUp,
            download: node.netDown,
            trafficUsed: workbenchNode.traffic.used,
            trafficRemaining: hasTrafficLimit ? workbenchNode.traffic.remaining : null,
            trafficUsage: hasTrafficLimit ? workbenchNode.traffic.fraction : null,
            trafficLimit: hasTrafficLimit ? workbenchNode.traffic.limit : null,
            latency: ping?.lastValue ?? null,
            loss: ping?.loss ?? null,
            uptime: node.uptime,
            updatedAt: node.updatedAt > 0 ? node.updatedAt : null,
            expiry: resolveExpireTimestamp(meta.expired_at),
            expireDays: workbenchNode.expireDays,
            price: priceLabel == null ? null : Math.max(0, meta.price),
            risk:
              workbenchNode.riskSeverity === "critical"
                ? 2
                : workbenchNode.riskSeverity === "warning"
                  ? 1
                  : 0,
            completeness: workbenchNode.completeness.ratio,
          };
        })
        .filter((node): node is VpsListSortableNode => Boolean(node));
      const matchedUuidSet = new Set(sortableNodes.map((node) => node.uuid));
      const sorted = sortVpsListNodes(sortableNodes, listSorts)
        .map((node) => nodeByUuid.get(node.uuid))
        .filter((node): node is HomeNodeSummary => Boolean(node));
      return [
        ...sorted,
        ...riskFiltered.filter((node) => !matchedUuidSet.has(node.uuid)),
      ];
    }

    const moveOfflineBack = themeSettings.isReady && themeSettings.moveOfflineNodesBack;

    if (workbenchSort === "weight") {
      return sortHomeNodeSummaries(riskFiltered, moveOfflineBack);
    }

    const nodeByUuid = new Map<string, HomeNodeSummary>(
      riskFiltered.map((node) => [node.uuid, node]),
    );
    const sortableWorkbenchNodes = riskFiltered
      .map((node) => workbenchNodesByUuid.get(node.uuid))
      .filter((node): node is VpsWorkbenchNode => Boolean(node));
    const sortedNodes = sortWorkbenchNodes(sortableWorkbenchNodes, workbenchSort)
      .map((node) => nodeByUuid.get(node.uuid))
      .filter((node): node is HomeNodeSummary => Boolean(node));
    const unmatchedNodes = riskFiltered.filter((node) => !workbenchNodesByUuid.has(node.uuid));
    return [
      ...sortedNodes,
      ...sortHomeNodeSummaries(unmatchedNodes, moveOfflineBack),
    ];
  }, [
    facetFilteredUuidSet,
    facetSearchTextByUuid,
    visibleNodes,
    selectedRiskFilter,
    nodeSearch,
    workbenchSort,
    workbenchNodesByUuid,
    risksByUuid,
    themeSettings.isReady,
    themeSettings.moveOfflineNodesBack,
    workbenchMetaByUuid,
    mode,
    listSorts,
    pingByUuid,
  ]);

  useEffect(() => {
    if (
      selectedRiskFilter !== "all" &&
      countRiskNodes(operationRisks, selectedRiskFilter) === 0
    ) {
      setSelectedRiskFilter("all");
    }
  }, [operationRisks, selectedRiskFilter]);

  // summary 对象每隔约 1s tick 就换新引用,导致 filteredNodes(以及直接映射 uuid)
  // 不停重建。改用稳定的 uuid 签名作为卡片列表的 key,这样只有集合或顺序真正变化时
  // 才重渲染——每张卡各自订阅自己的 store 切片、独立更新。
  const uuidsKey = useMemo(
    () => filteredNodes.map((node) => node.uuid).join(UUID_KEY_SEPARATOR),
    [filteredNodes],
  );
  const handleListInteractionChange = useCallback(
    (active: boolean) => {
      if (active) {
        if (!listInteractionActive) frozenListOrderRef.current = uuidsKey;
        setListInteractionActive(true);
        return;
      }
      setListInteractionActive(false);
      frozenListOrderRef.current = "";
    },
    [listInteractionActive, uuidsKey],
  );
  const handleListSort = useCallback((key: VpsListSortKey, additive: boolean) => {
    setActiveSavedViewId("");
    setListInteractionActive(false);
    frozenListOrderRef.current = "";
    setListSorts((current) => toggleVpsListSort(current, key, additive));
  }, []);
  const changeListSortDirection = (index: number) => {
    setActiveSavedViewId("");
    setListSorts((current) =>
      current.map((condition, conditionIndex) =>
        conditionIndex === index
          ? { ...condition, direction: condition.direction === "asc" ? "desc" : "asc" }
          : condition,
      ),
    );
  };
  const moveListSort = (index: number, delta: -1 | 1) => {
    setActiveSavedViewId("");
    setListSorts((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };
  const removeListSort = (index: number) => {
    setActiveSavedViewId("");
    setListSorts((current) => {
      const next = current.filter((_, conditionIndex) => conditionIndex !== index);
      return next.length > 0
        ? next
        : DEFAULT_VPS_LIST_SORTS.map((condition) => ({ ...condition }));
    });
  };
  const resetListSorts = () => {
    setActiveSavedViewId("");
    setListSorts(DEFAULT_VPS_LIST_SORTS.map((condition) => ({ ...condition })));
  };
  const cards = useMemo(() => {
    const uuids = uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : [];
    return uuids.map((uuid) => (
      <div key={uuid} className="home-node-card-slot min-w-0">
        {mode === "compact" ? <CompactNodeCard uuid={uuid} /> : <NodeCard uuid={uuid} />}
      </div>
    ));
  }, [uuidsKey, mode]);
  const listUuids = useMemo(() => {
    const liveUuids = uuidsKey ? uuidsKey.split(UUID_KEY_SEPARATOR) : [];
    if (!listInteractionActive || !frozenListOrderRef.current) return liveUuids;
    const liveUuidSet = new Set(liveUuids);
    const frozenUuids = frozenListOrderRef.current
      .split(UUID_KEY_SEPARATOR)
      .filter((uuid) => liveUuidSet.has(uuid));
    const frozenUuidSet = new Set(frozenUuids);
    return [...frozenUuids, ...liveUuids.filter((uuid) => !frozenUuidSet.has(uuid))];
  }, [listInteractionActive, uuidsKey]);
  const compareHref = useMemo(() => {
    const seed =
      selectedNodeUuids.length >= 2
        ? selectedNodeUuids.slice(0, HOME_COMPARE_SEED_COUNT)
        : filteredNodes.slice(0, HOME_COMPARE_SEED_COUNT).map((node) => node.uuid);
    if (seed.length < 2) return "/compare";
    return `/compare?${new URLSearchParams({ nodes: seed.join(",") }).toString()}`;
  }, [filteredNodes, selectedNodeUuids]);
  const showFacetRail =
    themeSettings.isReady &&
    themeSettings.showGroupTabs &&
    visibleFacetDimensions.length > 0;
  const gridClassName = mode === "compact" || mode === "list" ? "grid gap-3" : "grid gap-4 xl:gap-5";
  const gridColumns =
    mode === "list"
      ? "1fr"
      : mode === "compact"
      ? "repeat(auto-fill, minmax(min(100%, 260px), 1fr))"
      : "repeat(auto-fill, minmax(min(100%, 360px), 1fr))";
  const selectFacetValue = (dimensionId: string, value: string) => {
    setActiveSavedViewId("");
    setFacetFilters((prev) => {
      if (value === HOME_ALL_GROUP) return clearFacetFilter(prev, dimensionId);
      return {
        ...prev,
        [dimensionId]: prev[dimensionId]?.includes(value) ? prev[dimensionId].filter((item) => item !== value) : [value],
      };
    });
  };
  const clearAllFilters = () => {
    setActiveSavedViewId("");
    setFacetFilters({});
    setSelectedNodeUuids([]);
    setSelectedRiskFilter("all");
    setNodeSearch("");
  };

  const clearSelectedNodes = () => {
    setActiveSavedViewId("");
    setSelectedNodeUuids([]);
  };
  const toggleSelectedNode = (uuid: string, checked: boolean) => {
    setActiveSavedViewId("");
    setSelectedNodeUuids((prev) => {
      const next = new Set(prev);
      if (checked) next.add(uuid);
      else next.delete(uuid);
      return Array.from(next).sort((left, right) => left.localeCompare(right));
    });
  };
  const selectManyNodes = (uuids: string[]) => {
    setActiveSavedViewId("");
    setSelectedNodeUuids((prev) =>
      normalizeHomeSelectedNodeUuids([...prev, ...uuids]).sort((left, right) =>
        left.localeCompare(right),
      ),
    );
  };
  const hasActiveFilters =
    nodeSearch.trim().length > 0 ||
    selectedRiskFilter !== "all" ||
    selectedNodeUuids.length > 0 ||
    activeFacetFilterCount > 0 ||
    activeSavedViewId.length > 0;

  if (!themeSettings.isReady) {
    return (
      <div className="flex h-[40vh] items-center justify-center">
        <Spinner size={24} />
      </div>
    );
  }

  if (visibleNodes.length === 0) {
    return (
      <>
        {shouldRenderCostSummary && (
          <CostSummary
            open={costSummaryOpen}
            onOpenChange={setCostSummaryOpen}
            showLauncher={showCostFloatingButton}
          />
        )}
        <HomeWorkbenchPanel
          nodes={workbenchNodes}
          overview={overview}
          risks={operationRisks}
          expanded={workbenchOpen}
          showOverview={showHomeOverview}
          costSummary={costSummary}
          costLoading={costLoading}
          showCostDetailButton={showCostDetailButton}
          onOpenCostSummary={() => setCostSummaryOpen(true)}
          onToggle={() => setWorkbenchOpen((value) => !value)}
        />
        <div className="flex h-[40vh] flex-col items-center justify-center gap-2 text-[var(--text-tertiary)]">
          <span className="text-[15px]">尚未连接到任何节点</span>
          <span className="text-[12px]">等待后端推送或前往管理后台添加</span>
          <Link to="/compare" className="home-empty-compare">
            <BarChart3 size={14} aria-hidden="true" />
            打开对比工作台
          </Link>
          <Link to="/fleet-3d" className="home-empty-3d">
            <Network size={14} aria-hidden="true" />
            打开 3D 星图
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      {shouldRenderCostSummary && (
        <CostSummary
          open={costSummaryOpen}
          onOpenChange={setCostSummaryOpen}
          showLauncher={showCostFloatingButton}
        />
      )}
      <HomeWorkbenchPanel
        nodes={workbenchNodes}
        overview={overview}
        risks={operationRisks}
        expanded={workbenchOpen}
        showOverview={showHomeOverview}
        costSummary={costSummary}
        costLoading={costLoading}
        showCostDetailButton={showCostDetailButton}
        onOpenCostSummary={() => setCostSummaryOpen(true)}
        onToggle={() => setWorkbenchOpen((value) => !value)}
      />
      <section className="home-command-area" aria-label="VPS 搜索与筛选">
        <div className="home-command-bar">
          <label className="home-workbench-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              value={nodeSearch}
              onChange={(event) => setNodeSearch(event.target.value)}
              placeholder="搜索 VPS、UUID、备注或标签"
              aria-label="搜索 VPS"
            />
          </label>
          <HomeRiskFilters
            risks={operationRisks}
            selectedFilter={selectedRiskFilter}
            onSelectFilter={setSelectedRiskFilter}
          />
          <span
            className="home-command-result"
            title={`当前显示 ${filteredNodes.length} / ${visibleNodes.length} 台 VPS`}
          >
            <strong>{filteredNodes.length}</strong>
            <span>/ {visibleNodes.length} 台</span>
          </span>
          {themeSettings.homeSavedViews.length > 0 && (
            <label className="home-workbench-sort home-saved-view-picker">
              <Bookmark size={14} aria-hidden="true" />
              <select
                value={activeSavedViewId}
                onChange={(event) => {
                  const viewId = event.target.value;
                  if (viewId) applySavedView(viewId);
                  else setActiveSavedViewId("");
                }}
                aria-label="切换保存视图"
              >
                <option value="">手动视图</option>
                {themeSettings.homeSavedViews.map((view) => (
                  <option key={view.id} value={view.id}>
                    {view.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "list" ? (
            <button
              type="button"
              className="home-command-action"
              data-active={listSortPanelOpen ? "true" : "false"}
              aria-expanded={listSortPanelOpen}
              onClick={() => setListSortPanelOpen((value) => !value)}
            >
              <ListFilter size={14} aria-hidden="true" />
              <span>排序 {listSorts.length}</span>
            </button>
          ) : (
            <label className="home-workbench-sort">
              <ArrowUpDown size={14} aria-hidden="true" />
              <select
                value={workbenchSort}
                onChange={(event) => {
                  setActiveSavedViewId("");
                  setWorkbenchSort(event.target.value as WorkbenchSortKey);
                }}
                aria-label="排序 VPS"
              >
                {WORKBENCH_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            type="button"
            className="home-command-action"
            data-active={selectedNodeUuids.length > 0 ? "true" : "false"}
            aria-expanded={nodeSelectorOpen}
            onClick={() => setNodeSelectorOpen((value) => !value)}
            title="指定要显示或对比的 VPS"
          >
            <ListChecks size={14} aria-hidden="true" />
            <span>
              {selectedNodeUuids.length > 0
                ? `指定 ${selectedNodeUuids.length}`
                : "指定 VPS"}
            </span>
          </button>
          {selectedNodeUuids.length >= 2 && (
            <Link
              to={compareHref}
              className="home-command-action is-contextual"
              title="对比已指定的 VPS（最多带入 3 台）"
            >
              <BarChart3 size={14} aria-hidden="true" />
              <span>对比 {Math.min(selectedNodeUuids.length, HOME_COMPARE_SEED_COUNT)}</span>
            </Link>
          )}
          <Link
            to="/fleet-3d"
            className="home-command-action is-view"
            title="打开 3D 舰队视图"
          >
            <Network size={14} aria-hidden="true" />
            <span>3D</span>
          </Link>
          {hasActiveFilters && (
            <button
              type="button"
              className="home-command-reset"
              onClick={clearAllFilters}
              title="清除搜索、状态和分类筛选"
              aria-label="清除全部筛选"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
        {mode === "list" && listSortPanelOpen && (
          <VpsListSortPanel
            sorts={listSorts}
            onToggle={(key) => handleListSort(key, true)}
            onChangeDirection={changeListSortDirection}
            onMove={moveListSort}
            onRemove={removeListSort}
            onReset={resetListSorts}
            onClose={() => setListSortPanelOpen(false)}
          />
        )}
        {nodeSelectorOpen && (
          <NodeSelectionPanel
            nodes={workbenchNodes}
            selectedUuids={selectedNodeUuids}
            searchTextByUuid={facetSearchTextByUuid}
            search={nodeSelectorSearch}
            onSearch={setNodeSelectorSearch}
            onToggleNode={toggleSelectedNode}
            onSelectMany={selectManyNodes}
            onClear={clearSelectedNodes}
            onClose={() => setNodeSelectorOpen(false)}
          />
        )}
        {showFacetRail && (
          <div className="home-facet-stack">
            <div className="home-facet-dimensions" role="group" aria-label="显示筛选类别">
              <span>分类</span>
              {visibleFacetDimensions.map((dimension) => <button type="button" key={dimension.id}
                aria-pressed={enabledDimensions.some((item) => item.id === dimension.id)}
                onClick={() => {
                  const current = enabledDimensions.map((item) => item.id);
                  const hiding = current.includes(dimension.id);
                  setShownDimensions(hiding ? current.filter((id) => id !== dimension.id) : [...current, dimension.id]);
                  if (hiding) { setFacetFilters((prev) => clearFacetFilter(prev, dimension.id)); setActiveSavedViewId(""); }
                }}>{dimension.label}</button>)}
              <small>跨类别同时筛选</small>
            </div>
            {facetRows.filter(({ dimension }) => enabledDimensions.some((item) => item.id === dimension.id)).map(({ dimension, options, counts }) => <FacetRail
              key={dimension.id}
              dimensions={visibleFacetDimensions}
              dimensionCoverage={facetDimensionCoverage}
              selectedDimension={dimension.id}
              options={options}
              optionCounts={counts}
              selectedValues={facetFilters[dimension.id] ?? []}
              activeFilterCount={facetFilters[dimension.id]?.length ?? 0}
              onSelectValue={(value) => selectFacetValue(dimension.id, value)}
            />)}
          </div>
        )}

      </section>
      {listUuids.length > 0 ? (
        mode === "list" ? (
          <NodeList
            uuids={listUuids}
            sorts={listSorts}
            onSort={handleListSort}
            onInteractionChange={handleListInteractionChange}
          />
        ) : (
          <div className={gridClassName} style={{ gridTemplateColumns: gridColumns }}>{cards}</div>
        )
      ) : (
        <div className="home-filter-empty">当前筛选下没有匹配的 VPS</div>
      )}
    </>
  );
}
