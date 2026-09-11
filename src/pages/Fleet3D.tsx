import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Download,
  Globe2,
  Maximize2,
  Network,
  Radar,
  Route,
  X,
} from "lucide-react";
import { Fleet3DScene } from "@/components/fleet3d/Fleet3DScene";
import { useAllNodeMeta, useHomeNodeSummaries } from "@/hooks/useNode";
import { useHomepagePingOverview, usePingMiniMap } from "@/hooks/usePingMini";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { getComparisonLoadRecords } from "@/services/api";
import {
  buildCompareHref,
  buildFleet3DAnomalyStory,
  buildFleet3DCruiseTargets,
  buildFleet3DDemoModel,
  buildFleet3DGlobeLayout,
  buildFleet3DModel,
  buildFleet3DReplayState,
  detectFleet3DRendererCapability,
  filterFleet3DNodes,
  getFleet3DFocusOptions,
  resolveFleet3DManualInteractionState,
  resolveFleet3DFocus,
  type Fleet3DCameraPreset,
  type Fleet3DFilter,
  type Fleet3DFocusKind,
  type Fleet3DLayoutMode,
  type Fleet3DNode,
  type Fleet3DQuality,
  type Fleet3DRendererCapability,
  type Fleet3DStatus,
} from "@/utils/fleet3d";
import {
  formatBytes,
  formatByteRateLabel,
  formatLatency,
  formatMetricPercent,
  formatPacketLoss,
} from "@/utils/format";
import {
  formatDisplayDateTime,
  getZonedDateTimeParts,
  type DisplayTimeZone,
} from "@/utils/timeDisplay";

const MAX_COMPARE_NODES = 8;
const CRUISE_STEP_MS = 6500;
const TIMELINE_RANGES = [
  { value: 1, label: "1h" },
  { value: 4, label: "4h" },
  { value: 24, label: "1d" },
] as const;
const CAMERA_PRESETS: Array<{ value: Fleet3DCameraPreset; label: string }> = [
  { value: "overview", label: "全景" },
  { value: "close", label: "近景" },
  { value: "wide", label: "广角" },
];
const FOCUS_KIND_OPTIONS: Array<{ value: Fleet3DFocusKind; label: string }> = [
  { value: "all", label: "全部" },
  { value: "group", label: "分组" },
  { value: "region", label: "地区" },
];
const QUALITY_OPTIONS: Array<{ value: Fleet3DQuality; label: string }> = [
  { value: "high", label: "高画质" },
  { value: "balanced", label: "均衡" },
  { value: "eco", label: "省电" },
];

const STATUS_LABELS: Record<Fleet3DStatus, string> = {
  online: "在线",
  offline: "离线",
  unknown: "未知",
};

const RISK_LABELS = {
  none: "正常",
  warning: "需关注",
  critical: "高风险",
} as const;

type SnapshotStatus = "idle" | "saving" | "saved" | "failed";

const FILTERS: Array<{ value: Fleet3DFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "online", label: "在线" },
  { value: "offline", label: "离线" },
  { value: "unknown", label: "未知" },
];

function uniqueLimited(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).slice(0, MAX_COMPARE_NODES);
}

function countForFilter(filter: Fleet3DFilter, model: ReturnType<typeof buildFleet3DModel>) {
  if (filter === "all") return model.nodes.length;
  return model[filter];
}

function statusClass(status: Fleet3DStatus) {
  return `is-${status}`;
}

function pad2(value: number) {
  return value.toString().padStart(2, "0");
}

function formatSyncTime(timestamp: number) {
  if (!timestamp) return "等待同步";
  const elapsedMs = Date.now() - timestamp;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "刚刚";
  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) return "刚刚";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function formatReplayTime(timestamp: number, displayTimeZone: DisplayTimeZone) {
  if (!timestamp) return "等待数据";
  return formatDisplayDateTime(timestamp, displayTimeZone, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatReplayPressure(node: Fleet3DNode) {
  if (!node.replay?.active) return "实时";
  return `${Math.round(node.replay.pressure * 100)}%`;
}

function snapshotFileName(displayTimeZone: DisplayTimeZone) {
  const parts = getZonedDateTimeParts(Date.now(), displayTimeZone);
  const timestamp = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}-${pad2(parts.hour)}-${pad2(parts.minute)}-${pad2(parts.second)}`;
  return `aster-3d-fleet-${timestamp}.png`;
}

function formatPingLatency(node: Fleet3DNode) {
  if (!node.ping.assigned) return "未绑定";
  if (node.ping.latency == null) return "等待样本";
  return formatLatency(node.ping.latency);
}

function formatPingLoss(node: Fleet3DNode) {
  if (!node.ping.assigned) return "未绑定";
  if (node.ping.loss == null) return "—";
  return formatPacketLoss(node.ping.loss);
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: Fleet3DStatus;
}) {
  return (
    <div className={`fleet3d-stat-pill ${tone ? statusClass(tone) : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Inspector({
  node,
  inCompare,
  onToggleCompare,
}: {
  node: Fleet3DNode | null;
  inCompare: boolean;
  onToggleCompare: (uuid: string) => void;
}) {
  if (!node) {
    return (
      <aside className="fleet3d-inspector" aria-label="节点检查器">
        <p className="fleet3d-eyebrow">节点检查器</p>
        <h2>选择一台 VPS</h2>
        <p className="fleet3d-muted">点选星图节点后查看实时带宽、流量、分组与同步状态。</p>
      </aside>
    );
  }

  return (
    <aside className="fleet3d-inspector" aria-label={`${node.name} 节点检查器`}>
      <div className="fleet3d-inspector-heading">
        <div>
          <p className="fleet3d-eyebrow">{node.group}</p>
          <h2>{node.name}</h2>
        </div>
        <span className={`fleet3d-node-status ${statusClass(node.status)}`}>
          {STATUS_LABELS[node.status]}
        </span>
      </div>
      <dl className="fleet3d-node-metrics">
        <div>
          <dt>地区</dt>
          <dd>{node.region}</dd>
        </div>
        <div>
          <dt>实时带宽</dt>
          <dd>{formatByteRateLabel(node.netRate)}</dd>
        </div>
        <div>
          <dt>累计流量</dt>
          <dd>{formatBytes(node.trafficTotal)}</dd>
        </div>
        <div>
          <dt>同步</dt>
          <dd>{formatSyncTime(node.updatedAt)}</dd>
        </div>
        <div>
          <dt>Ping 延迟</dt>
          <dd>{formatPingLatency(node)}</dd>
        </div>
        <div>
          <dt>Ping 丢包</dt>
          <dd>{formatPingLoss(node)}</dd>
        </div>
        <div>
          <dt>风险</dt>
          <dd>{RISK_LABELS[node.risk.tone]}</dd>
        </div>
        <div>
          <dt>资料完整度</dt>
          <dd>{formatMetricPercent(node.risk.completenessRatio * 100)}</dd>
        </div>
        <div>
          <dt>回放压力</dt>
          <dd>{formatReplayPressure(node)}</dd>
        </div>
      </dl>
      {node.risk.issues.length > 0 && (
        <div className="fleet3d-risk-issues">
          {node.risk.issues.map((issue) => (
            <span key={issue}>{issue}</span>
          ))}
        </div>
      )}
      <div className="fleet3d-inspector-actions">
        <button type="button" onClick={() => onToggleCompare(node.uuid)}>
          <BarChart3 size={15} aria-hidden="true" />
          <span>{inCompare ? "移出对比" : "加入对比"}</span>
        </button>
        <Link to={`/instance/${node.uuid}`}>
          <Network size={15} aria-hidden="true" />
          <span>详情</span>
        </Link>
      </div>
    </aside>
  );
}

export function Fleet3D() {
  const allNodes = useAllNodeMeta();
  const summaries = useHomeNodeSummaries();
  const themeSettings = useThemeSettings();
  const displayTimeZone = themeSettings.displayTimeZone;
  useHomepagePingOverview();
  const demoMode = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1";
  const [filter, setFilter] = useState<Fleet3DFilter>("all");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [compareUuids, setCompareUuids] = useState<string[]>([]);
  const [riskScan, setRiskScan] = useState(false);
  const [timelineEnabled, setTimelineEnabled] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineHours, setTimelineHours] = useState<(typeof TIMELINE_RANGES)[number]["value"]>(4);
  const [timelineProgress, setTimelineProgress] = useState(1);
  const [focusKind, setFocusKind] = useState<Fleet3DFocusKind>("all");
  const [focusValue, setFocusValue] = useState("");
  const [cameraPreset, setCameraPreset] = useState<Fleet3DCameraPreset>("overview");
  const [quality, setQuality] = useState<Fleet3DQuality>("balanced");
  const [rendererCapability, setRendererCapability] = useState<Fleet3DRendererCapability | null>(null);
  const [cruiseMode, setCruiseMode] = useState(false);
  const [cruiseIndex, setCruiseIndex] = useState(0);
  const [snapshotRequestId, setSnapshotRequestId] = useState(0);
  const [snapshotStatus, setSnapshotStatus] = useState<SnapshotStatus>("idle");
  const [storyMode, setStoryMode] = useState(false);
  const [storyIndex, setStoryIndex] = useState(0);
  const [layoutMode, setLayoutMode] = useState<Fleet3DLayoutMode>("orbit");
  const [fitRequestId, setFitRequestId] = useState(0);
  const [cameraControlState, setCameraControlState] = useState<"manual" | "auto">("manual");

  const visibleUuids = useMemo(
    () => allNodes.filter((node) => !node.hidden).map((node) => node.uuid),
    [allNodes],
  );
  const pingByUuid = usePingMiniMap(visibleUuids);
  const demoModel = useMemo(() => (demoMode ? buildFleet3DDemoModel() : null), [demoMode]);
  const model = useMemo(
    () => demoModel ?? buildFleet3DModel(allNodes, summaries, pingByUuid),
    [allNodes, demoModel, pingByUuid, summaries],
  );
  const visibleKey = useMemo(() => visibleUuids.join(","), [visibleUuids]);
  const replayQuery = useQuery({
    queryKey: ["fleet-3d", "timeline", visibleKey, timelineHours],
    queryFn: () =>
      getComparisonLoadRecords({
        uuids: visibleUuids,
        hours: timelineHours,
        loadType: "cpu",
        nodes: allNodes,
      }),
    enabled: timelineEnabled && visibleUuids.length > 0,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
  const replayState = useMemo(
    () =>
      timelineEnabled
        ? buildFleet3DReplayState(model.nodes, replayQuery.data ?? {}, timelineProgress)
        : null,
    [model.nodes, replayQuery.data, timelineEnabled, timelineProgress],
  );
  const renderedNodes = replayState?.nodes ?? model.nodes;
  const globeLayout = useMemo(
    () => buildFleet3DGlobeLayout(renderedNodes),
    [renderedNodes],
  );
  const activeLayoutMode = layoutMode === "globe" && globeLayout.available ? "globe" : "orbit";
  const layoutNodes = activeLayoutMode === "globe" ? globeLayout.nodes : renderedNodes;
  const focusOptions = useMemo(
    () =>
      focusKind === "all"
        ? []
        : getFleet3DFocusOptions(layoutNodes, focusKind),
    [focusKind, layoutNodes],
  );
  const activeFocusValue = focusKind === "all" ? "" : focusValue || focusOptions[0] || "";
  const focusState = useMemo(
    () => resolveFleet3DFocus(layoutNodes, focusKind, activeFocusValue),
    [activeFocusValue, focusKind, layoutNodes],
  );
  const visibleNodes = useMemo(
    () => filterFleet3DNodes(layoutNodes, filter),
    [filter, layoutNodes],
  );
  const cruiseTargets = useMemo(
    () => buildFleet3DCruiseTargets(visibleNodes),
    [visibleNodes],
  );
  const storySteps = useMemo(
    () => buildFleet3DAnomalyStory(visibleNodes, 6),
    [visibleNodes],
  );
  const activeCruiseTarget = cruiseMode && cruiseTargets.length > 0
    ? cruiseTargets[cruiseIndex % cruiseTargets.length]
    : null;
  const activeStoryStep = storyMode && storySteps.length > 0
    ? storySteps[storyIndex % storySteps.length]
    : null;
  const effectiveFocusedUuids = activeStoryStep
    ? [activeStoryStep.uuid]
    : activeCruiseTarget
      ? activeCruiseTarget.uuids
      : focusState.kind === "all"
        ? []
        : focusState.uuids;
  const effectiveFocusCenter = activeStoryStep?.center ?? activeCruiseTarget?.center ?? focusState.center;
  const effectiveCameraPreset = activeStoryStep ? "close" : activeCruiseTarget?.cameraPreset ?? cameraPreset;
  const effectiveRiskScan = riskScan || Boolean(activeCruiseTarget?.riskScan) || Boolean(activeStoryStep);
  const selectedNode = useMemo(
    () => layoutNodes.find((node) => node.uuid === selectedUuid) ?? null,
    [layoutNodes, selectedUuid],
  );
  const compareNodes = useMemo(
    () =>
      compareUuids
        .map((uuid) => layoutNodes.find((node) => node.uuid === uuid))
        .filter((node): node is Fleet3DNode => Boolean(node)),
    [compareUuids, layoutNodes],
  );
  const compareHref = useMemo(() => buildCompareHref(compareUuids), [compareUuids]);

  useEffect(() => {
    if (!timelineEnabled || !timelinePlaying) return;
    const timer = window.setInterval(() => {
      setTimelineProgress((value) => (value >= 1 ? 0 : Math.min(1, value + 0.025)));
    }, 900);
    return () => window.clearInterval(timer);
  }, [timelineEnabled, timelinePlaying]);

  useEffect(() => {
    setRendererCapability(detectFleet3DRendererCapability());
  }, []);

  useEffect(() => {
    if (layoutMode === "globe" && !globeLayout.available) setLayoutMode("orbit");
  }, [globeLayout.available, layoutMode]);

  useEffect(() => {
    if (!cruiseMode || cruiseTargets.length > 0) return;
    setCruiseMode(false);
    setCruiseIndex(0);
  }, [cruiseMode, cruiseTargets.length]);

  useEffect(() => {
    if (!storyMode || storySteps.length > 0) return;
    setStoryMode(false);
    setStoryIndex(0);
  }, [storyMode, storySteps.length]);

  useEffect(() => {
    if (cruiseTargets.length === 0) return;
    setCruiseIndex((value) => value % cruiseTargets.length);
  }, [cruiseTargets.length]);

  useEffect(() => {
    if (!cruiseMode || cruiseTargets.length <= 1) return;
    const timer = window.setInterval(() => {
      setCruiseIndex((value) => (value + 1) % cruiseTargets.length);
    }, CRUISE_STEP_MS);
    return () => window.clearInterval(timer);
  }, [cruiseMode, cruiseTargets.length]);

  useEffect(() => {
    if (!activeCruiseTarget) return;
    setSelectedUuid(activeCruiseTarget.attentionUuid ?? activeCruiseTarget.uuids[0] ?? null);
  }, [activeCruiseTarget]);

  useEffect(() => {
    if (!activeStoryStep) return;
    setSelectedUuid(activeStoryStep.uuid);
  }, [activeStoryStep]);

  useEffect(() => {
    if (snapshotStatus === "idle" || snapshotStatus === "saving") return;
    const timer = window.setTimeout(() => setSnapshotStatus("idle"), 2200);
    return () => window.clearTimeout(timer);
  }, [snapshotStatus]);

  const toggleCompare = useCallback((uuid: string) => {
    setCompareUuids((current) => {
      if (current.includes(uuid)) return current.filter((item) => item !== uuid);
      return uniqueLimited([...current, uuid]);
    });
  }, []);

  const stopAutomationForManualControl = useCallback(() => {
    const next = resolveFleet3DManualInteractionState();
    setCameraControlState(next.cameraControlState);
    setCruiseMode(next.cruiseMode);
    setStoryMode(next.storyMode);
  }, []);

  const requestFitAll = useCallback(() => {
    stopAutomationForManualControl();
    setFitRequestId((value) => value + 1);
  }, [stopAutomationForManualControl]);

  const selectCameraPreset = useCallback((preset: Fleet3DCameraPreset) => {
    stopAutomationForManualControl();
    setCameraPreset(preset);
  }, [stopAutomationForManualControl]);

  const handleUserCameraControl = useCallback(() => {
    stopAutomationForManualControl();
  }, [stopAutomationForManualControl]);

  const handleMarqueeSelect = useCallback((uuids: string[]) => {
    setCompareUuids(uniqueLimited(uuids));
    if (uuids[0]) setSelectedUuid(uuids[0]);
  }, []);

  const handleSelectNode = useCallback((uuid: string | null) => {
    setSelectedUuid(uuid);
    stopAutomationForManualControl();
  }, [stopAutomationForManualControl]);

  const toggleCruiseMode = useCallback(() => {
    setCruiseMode((value) => {
      const next = !value;
      if (next) {
        setCruiseIndex(0);
        setStoryMode(false);
        setCameraControlState("auto");
      } else {
        setCameraControlState("manual");
      }
      return next;
    });
  }, []);

  const toggleStoryMode = useCallback(() => {
    setStoryMode((value) => {
      const next = !value;
      if (next) {
        setStoryIndex(0);
        setCruiseMode(false);
        setCameraControlState("auto");
      } else {
        setCameraControlState("manual");
      }
      return next;
    });
  }, []);

  const requestSnapshot = useCallback(() => {
    setSnapshotStatus("saving");
    setSnapshotRequestId((value) => value + 1);
  }, []);

  const handleSnapshotReady = useCallback((dataUrl: string | null) => {
    if (!dataUrl) {
      setSnapshotStatus("failed");
      return;
    }
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = snapshotFileName(displayTimeZone);
    link.click();
    setSnapshotStatus("saved");
  }, [displayTimeZone]);

  return (
    <section className="fleet3d-page" aria-label="VPS 3D 星图" data-demo-mode={demoMode || undefined}>
      <Fleet3DScene
        nodes={visibleNodes}
        orbits={model.orbits}
        selectedUuid={selectedUuid}
        compareUuids={compareUuids}
        riskScan={effectiveRiskScan}
        cameraPreset={effectiveCameraPreset}
        layoutMode={activeLayoutMode}
        focusCenter={effectiveFocusCenter}
        focusedUuids={effectiveFocusedUuids}
        quality={quality}
        rendererMode={rendererCapability?.mode ?? "unavailable"}
        snapshotRequestId={snapshotRequestId}
        fitRequestId={fitRequestId}
        onSelectNode={handleSelectNode}
        onMarqueeSelect={handleMarqueeSelect}
        onSnapshotReady={handleSnapshotReady}
        onUserCameraControl={handleUserCameraControl}
      />

      <header className="fleet3d-topbar">
        <div className="fleet3d-titlebar">
          <Link to="/" className="fleet3d-icon-button" aria-label="返回主页">
            <ChevronLeft size={18} aria-hidden="true" />
          </Link>
          <div>
            <p className="fleet3d-eyebrow">Aster</p>
            <h1>VPS 3D 星图</h1>
            <span
              className={`fleet3d-renderer-pill is-${rendererCapability?.mode ?? "unavailable"}`}
              title={rendererCapability?.detail ?? "正在检测 3D 渲染能力"}
            >
              {rendererCapability?.label ?? "检测中"}
            </span>
          </div>
        </div>
        <div className="fleet3d-status-strip" aria-label="舰队状态">
          <StatPill label="总数" value={model.nodes.length} />
          <StatPill label="在线" value={model.online} tone="online" />
          <StatPill label="离线" value={model.offline} tone="offline" />
          <StatPill label="未知" value={model.unknown} tone="unknown" />
        </div>
        <div className="fleet3d-action-group">
          <span className={`fleet3d-camera-state is-${cameraControlState}`} data-camera-control-state>
            {cameraControlState === "auto" ? "自动" : "手动"}
          </span>
          <button
            type="button"
            className="fleet3d-fit-button"
            onClick={requestFitAll}
            title="适配全部可见节点"
          >
            <Maximize2 size={16} aria-hidden="true" />
            <span>适配</span>
          </button>
          <button
            type="button"
            className={`fleet3d-cruise-button ${cruiseMode ? "is-active" : ""}`}
            onClick={toggleCruiseMode}
            disabled={cruiseTargets.length === 0}
            aria-pressed={cruiseMode}
          >
            <Radar size={16} aria-hidden="true" />
            <span>巡航</span>
            <strong>{cruiseTargets.length}</strong>
          </button>
          <button
            type="button"
            className={`fleet3d-risk-button ${riskScan ? "is-active" : ""}`}
            onClick={() => setRiskScan((value) => !value)}
            aria-pressed={riskScan}
          >
            <AlertTriangle size={16} aria-hidden="true" />
            <span>风险</span>
            <strong>{model.riskCritical + model.riskWarning}</strong>
          </button>
          <button
            type="button"
            className={`fleet3d-story-button ${storyMode ? "is-active" : ""}`}
            onClick={toggleStoryMode}
            disabled={storySteps.length === 0}
            aria-pressed={storyMode}
          >
            <Route size={16} aria-hidden="true" />
            <span>导览</span>
            <strong>{storySteps.length}</strong>
          </button>
          <button
            type="button"
            className={`fleet3d-snapshot-button is-${snapshotStatus}`}
            onClick={requestSnapshot}
            disabled={snapshotStatus === "saving"}
            title="导出当前 3D 星图快照"
          >
            <Download size={16} aria-hidden="true" />
            <span>{snapshotStatus === "saving" ? "生成中" : snapshotStatus === "saved" ? "已保存" : "快照"}</span>
          </button>
          <Link to={compareHref} className="fleet3d-compare-button">
            <BarChart3 size={16} aria-hidden="true" />
            <span>对比</span>
            <strong>{compareUuids.length}</strong>
          </Link>
        </div>
      </header>

      <nav className="fleet3d-filterbar" aria-label="星图筛选">
        {FILTERS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={filter === item.value ? "is-active" : ""}
            onClick={() => setFilter(item.value)}
          >
            <span>{item.label}</span>
            <strong>{countForFilter(item.value, model)}</strong>
          </button>
        ))}
      </nav>

      <div className="fleet3d-focus-panel" aria-label="聚焦与相机">
        <div className="fleet3d-focus-selects">
          <label>
            <span>聚焦</span>
            <select
              value={focusKind}
              onChange={(event) => {
                const next = event.target.value as Fleet3DFocusKind;
                stopAutomationForManualControl();
                setFocusKind(next);
                setFocusValue("");
              }}
            >
              {FOCUS_KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {focusKind !== "all" && (
            <label>
              <span>{focusKind === "group" ? "分组" : "地区"}</span>
              <select
                value={activeFocusValue}
                onChange={(event) => {
                  stopAutomationForManualControl();
                  setFocusValue(event.target.value);
                }}
              >
                {focusOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="fleet3d-camera-presets">
          {CAMERA_PRESETS.map((preset) => (
            <button
              key={preset.value}
              type="button"
              className={cameraPreset === preset.value ? "is-active" : ""}
              onClick={() => selectCameraPreset(preset.value)}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="fleet3d-quality-controls" aria-label="视觉质量">
          {QUALITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={quality === option.value ? "is-active" : ""}
              onClick={() => setQuality(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="fleet3d-layout-controls" aria-label="空间布局">
          <button
            type="button"
            className={activeLayoutMode === "orbit" ? "is-active" : ""}
            onClick={() => {
              stopAutomationForManualControl();
              setLayoutMode("orbit");
            }}
          >
            星图
          </button>
          <button
            type="button"
            className={activeLayoutMode === "globe" ? "is-active" : ""}
            onClick={() => {
              stopAutomationForManualControl();
              setLayoutMode("globe");
            }}
            disabled={!globeLayout.available}
            title={globeLayout.available ? "按可靠地区坐标显示地球模式" : "可定位地区不足，暂不可用"}
          >
            <Globe2 size={13} aria-hidden="true" />
            <span>地球</span>
            <small>{globeLayout.matched}/{globeLayout.total}</small>
          </button>
        </div>
        <div className="fleet3d-visual-legend" aria-label="视觉图例">
          <span><i className="is-status" />状态</span>
          <span><i className="is-risk" />风险</span>
          <span><i className="is-resource" />资源</span>
          <span><i className="is-traffic" />流量</span>
        </div>
        {activeCruiseTarget && (
          <div className="fleet3d-cruise-status" aria-live="polite">
            <span>NOC 巡航</span>
            <strong>{activeCruiseTarget.label}</strong>
            <small>{activeCruiseTarget.detail}</small>
          </div>
        )}
      </div>

      {activeStoryStep && (
        <aside className={`fleet3d-story-panel is-${activeStoryStep.tone}`} aria-label="异常导览">
          <div className="fleet3d-story-head">
            <div>
              <p className="fleet3d-eyebrow">
                异常导览 {storyIndex + 1}/{storySteps.length}
              </p>
              <h2>{activeStoryStep.title}</h2>
            </div>
            <button type="button" onClick={() => setStoryMode(false)} aria-label="关闭异常导览">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
          <p className="fleet3d-story-detail">{activeStoryStep.detail}</p>
          <div className="fleet3d-story-issues">
            {activeStoryStep.issues.slice(0, 3).map((issue) => (
              <span key={issue}>{issue}</span>
            ))}
          </div>
          <div className="fleet3d-story-actions">
            <button
              type="button"
              onClick={() => setStoryIndex((value) => (value + storySteps.length - 1) % storySteps.length)}
            >
              <ChevronLeft size={15} aria-hidden="true" />
              <span>上一个</span>
            </button>
            <button
              type="button"
              onClick={() => setStoryIndex((value) => (value + 1) % storySteps.length)}
            >
              <span>下一个</span>
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </div>
        </aside>
      )}

      {model.nodes.length === 0 && (
        <div className="fleet3d-empty-state">
          <p className="fleet3d-eyebrow">暂无节点</p>
          <h2>星图等待第一台 VPS</h2>
          <Link to="/">返回主页</Link>
        </div>
      )}

      <div className="fleet3d-timeline-panel" aria-label="历史回放">
        <div className="fleet3d-timeline-head">
          <div>
            <p className="fleet3d-eyebrow">Timeline</p>
            <strong>
              {timelineEnabled
                ? formatReplayTime(replayState?.timestamp ?? 0, displayTimeZone)
                : "实时视图"}
            </strong>
          </div>
          <button
            type="button"
            className={timelineEnabled ? "is-active" : ""}
            onClick={() => {
              setTimelineEnabled((value) => !value);
              setTimelineProgress(1);
              setTimelinePlaying(false);
            }}
          >
            {timelineEnabled ? "关闭" : "回放"}
          </button>
        </div>
        <div className="fleet3d-timeline-ranges">
          {TIMELINE_RANGES.map((range) => (
            <button
              key={range.value}
              type="button"
              className={timelineHours === range.value ? "is-active" : ""}
              onClick={() => {
                setTimelineHours(range.value);
                setTimelineProgress(1);
              }}
            >
              {range.label}
            </button>
          ))}
          <button
            type="button"
            className={timelinePlaying ? "is-active" : ""}
            disabled={!timelineEnabled || replayQuery.isLoading}
            onClick={() => setTimelinePlaying((value) => !value)}
          >
            {timelinePlaying ? "暂停" : "播放"}
          </button>
        </div>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(timelineProgress * 1000)}
          disabled={!timelineEnabled}
          onChange={(event) => {
            setTimelinePlaying(false);
            setTimelineProgress(Number(event.target.value) / 1000);
          }}
          aria-label="历史回放进度"
        />
        <div className="fleet3d-timeline-foot">
          <span>{replayQuery.isFetching ? "同步中" : `${replayState?.sampleCount ?? 0} 样本`}</span>
          <span>{timelineEnabled ? `${Math.round(timelineProgress * 100)}%` : "Live"}</span>
        </div>
      </div>

      <Inspector
        node={selectedNode}
        inCompare={selectedNode ? compareUuids.includes(selectedNode.uuid) : false}
        onToggleCompare={toggleCompare}
      />

      <div className="fleet3d-compare-tray" aria-label="对比托盘">
        <div>
          <p className="fleet3d-eyebrow">对比托盘</p>
          <strong>{compareUuids.length < 2 ? "至少选择 2 台 VPS" : `${compareUuids.length} 台 VPS`}</strong>
        </div>
        <div className="fleet3d-compare-nodes">
          {compareNodes.length === 0 ? (
            <span>框选或在检查器中加入节点</span>
          ) : (
            compareNodes.map((node) => (
              <button
                key={node.uuid}
                type="button"
                onClick={() => toggleCompare(node.uuid)}
                title={`移出 ${node.name}`}
              >
                <span>{node.name}</span>
                <X size={12} aria-hidden="true" />
              </button>
            ))
          )}
        </div>
        <Link
          to={compareHref}
          className={`fleet3d-tray-action ${compareUuids.length < 2 ? "is-disabled" : ""}`}
          aria-disabled={compareUuids.length < 2}
        >
          <BarChart3 size={15} aria-hidden="true" />
          <span>打开对比</span>
        </Link>
      </div>
    </section>
  );
}
import "@/styles/fleet-3d.css";
