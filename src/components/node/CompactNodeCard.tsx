import { memo, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  CircleDollarSign,
  Cpu,
  Database,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
} from "lucide-react";
import { clsx } from "clsx";
import { Flag } from "@/components/ui/Flag";
import { OsLogo } from "@/components/ui/OsLogo";
import { useNodeCardModel } from "@/hooks/useNodeCardModel";
import { useThemeSettings } from "@/hooks/useThemeSettings";
import { formatBytes, formatLoadValue, formatMetricPercent, trimFixed } from "@/utils/format";
import {
  buildHomepagePingCompareUrl,
  buildHomepagePingSourceRows,
  type HomepagePingSourceRow,
} from "@/utils/homepagePingSources";
import { speedRateColor, speedRateColorFromBytes } from "@/utils/metricTone";
import { PingSourceMatrix } from "./PingSourceMatrix";
import { joinTagTitle, nodeDetailLinkLabels, pingEmptyLabels } from "./nodeCardShared";
import type { NodeInfo, NodeMetrics, TrafficTrendSample } from "@/types/komari";
import type { ByteRateDisplay } from "@/utils/format";
import type { TrafficDisplay } from "@/utils/traffic";

const TRAFFIC_DOT_COUNT = 12;
type CompactNode = NodeInfo & NodeMetrics;
type CompactTag = { label: string; color: string };
type CompactExpire = { value: string; unit: string };

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatCompactPercent(value: number) {
  if (!Number.isFinite(value)) return "0%";
  return formatMetricPercent(value, { digits: Math.abs(value) < 1 ? 2 : 1 });
}

function formatCompactExpire({ value, unit }: CompactExpire) {
  if (value === "—") return "到期 --";
  return unit ? `${value}${unit}` : value;
}

function formatCompactUptime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const days = seconds / 86400;
  const value = days >= 1 ? Math.floor(days).toString() : trimFixed(days, 2);
  return `${value}天`;
}

function CompactGauge({
  icon,
  label,
  value,
  detail,
  color,
  fraction,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  color: string;
  fraction: number;
}) {
  const style = {
    "--compact-gauge-color": color,
    "--compact-gauge-fill": `${clamp01(fraction) * 100}%`,
  } as CSSProperties;

  return (
    <div
      className="compact-node-gauge"
      style={style}
      title={detail ? `${label} ${value} · ${detail}` : `${label} ${value}`}
      aria-label={detail ? `${label} ${value}，${detail}` : `${label} ${value}`}
    >
      <div className="compact-node-gauge-head">
        <span className="compact-node-gauge-label">
          {icon}
          <span>{label}</span>
        </span>
        <strong className="tabular">{value}</strong>
      </div>
      <div className="compact-node-gauge-track" aria-hidden />
    </div>
  );
}

function CompactTrafficPulse({
  up,
  down,
}: {
  up: TrafficTrendSample[];
  down: TrafficTrendSample[];
}) {
  const upSelected = up.slice(-TRAFFIC_DOT_COUNT);
  const downSelected = down.slice(-TRAFFIC_DOT_COUNT);
  const padding = Math.max(0, TRAFFIC_DOT_COUNT - Math.max(upSelected.length, downSelected.length));

  return (
    <span className="compact-node-traffic-pulse" aria-hidden>
      {Array.from({ length: TRAFFIC_DOT_COUNT }, (_, index) => {
        const sampleIndex = index - padding;
        const upSample = sampleIndex >= 0 ? upSelected[upSelected.length - (TRAFFIC_DOT_COUNT - index)] : null;
        const downSample = sampleIndex >= 0
          ? downSelected[downSelected.length - (TRAFFIC_DOT_COUNT - index)]
          : null;
        const value = Math.max(upSample?.value ?? 0, downSample?.value ?? 0);
        const level = Math.max(upSample?.level ?? 0, downSample?.level ?? 0);
        return (
          <span
            key={index}
            style={{
              "--compact-traffic-dot-color":
                value > 0 ? speedRateColorFromBytes(value) : "var(--progress-bg)",
              "--compact-traffic-dot-scale": value > 0 ? `${0.72 + level * 0.5}` : "0.52",
              opacity: value > 0 ? 0.55 + level * 0.4 : 0.34,
            } as CSSProperties}
          />
        );
      })}
    </span>
  );
}

function CompactNodeHeader({
  node,
  osName,
  isOffline,
}: {
  node: CompactNode;
  osName: string;
  isOffline: boolean;
}) {
  const detailLabels = nodeDetailLinkLabels(node.name, osName);
  return (
    <header className="compact-node-header">
      <div className="compact-node-title-row">
        <Flag region={node.region} size={14} />
        <Link to={`/instance/${node.uuid}`} className="compact-node-title" title={node.name}>
          {node.name}
        </Link>
        {isOffline && (
          <span className="compact-node-offline-badge" title="服务器离线">
            离线
          </span>
        )}
      </div>
      <Link
        to={`/instance/${node.uuid}`}
        className="compact-node-detail-link"
        title={detailLabels.title}
        aria-label={detailLabels.ariaLabel}
      >
        <OsLogo value={node.os} size={14} />
      </Link>
    </header>
  );
}

function CompactNodeMeta({
  subtitle,
  tags,
  showBilling,
  expire,
  expireColor,
  renewalPrice,
  uptimeLabel,
  showConnections,
  connections,
}: {
  subtitle: string;
  tags: CompactTag[];
  showBilling: boolean;
  expire: CompactExpire;
  expireColor: string;
  renewalPrice: string | null;
  uptimeLabel: string;
  showConnections: boolean;
  connections: number;
}) {
  return (
    <div className="compact-node-meta-row" title={joinTagTitle(tags)}>
      <div className="compact-node-tag-lane">
        {subtitle && <span className="compact-node-subtitle">{subtitle}</span>}
        {tags.map((tag, index) => (
          <span key={`${tag.label}-${index}`} className="compact-node-tag" data-tag={tag.color}>
            {tag.label}
          </span>
        ))}
      </div>
      <div className="compact-node-meta-facts">
        {uptimeLabel && <span>在线 {uptimeLabel}</span>}
        {showConnections && (
          <span title="TCP + UDP 连接数">
            <Network size={10} />
            {connections.toLocaleString()}
          </span>
        )}
        {showBilling && (
          <>
            <span style={{ color: expireColor }}>
              <Calendar size={10} />
              {formatCompactExpire(expire)}
            </span>
            {renewalPrice && (
              <span className="is-price">
                <CircleDollarSign size={10} />
                {renewalPrice}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CompactNodeVitals({ node, loadFraction }: { node: CompactNode; loadFraction: number }) {
  return (
    <div className="compact-node-vitals">
      <CompactGauge
        icon={<Cpu size={11} />}
        label="CPU"
        value={formatCompactPercent(node.cpuPct)}
        detail={`${node.cpu_cores || 0} 核`}
        fraction={node.cpuPct / 100}
        color="var(--progress-cpu)"
      />
      <CompactGauge
        icon={<MemoryStick size={11} />}
        label="内存"
        value={formatCompactPercent(node.ramPct)}
        detail={`${formatBytes(node.ramUsed)} / ${formatBytes(node.ramTotal)}`}
        fraction={node.ramPct / 100}
        color="var(--progress-memory)"
      />
      <CompactGauge
        icon={<HardDrive size={11} />}
        label="磁盘"
        value={formatCompactPercent(node.diskPct)}
        detail={`${formatBytes(node.diskUsed)} / ${formatBytes(node.diskTotal)}`}
        fraction={node.diskPct / 100}
        color="var(--progress-disk)"
      />
      <CompactGauge
        icon={<Gauge size={11} />}
        label="负载"
        value={formatLoadValue(node.load1)}
        detail={`${formatLoadValue(node.load5)} / ${formatLoadValue(node.load15)}`}
        fraction={loadFraction}
        color="var(--progress-network)"
      />
    </div>
  );
}

function CompactRate({
  direction,
  rate,
}: {
  direction: "up" | "down";
  rate: ByteRateDisplay;
}) {
  const color = speedRateColor(rate.unit);
  return (
    <span className="compact-node-rate" style={{ color }}>
      {direction === "up" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
      <strong className="tabular">{rate.value}</strong>
      <small>{rate.unit}</small>
    </span>
  );
}

function CompactLiveTraffic({
  node,
  traffic,
  trafficTrend,
  upRate,
  downRate,
  showTrafficTotal,
}: {
  node: CompactNode;
  traffic: TrafficDisplay;
  trafficTrend: { up: TrafficTrendSample[]; down: TrafficTrendSample[] };
  upRate: ByteRateDisplay;
  downRate: ByteRateDisplay;
  showTrafficTotal: boolean;
}) {
  const style = {
    "--compact-traffic-fill": `${clamp01(traffic.fraction) * 100}%`,
    "--compact-traffic-color": traffic.color,
  } as CSSProperties;
  const totalTitle = showTrafficTotal
    ? ` · 上行 ${formatBytes(node.trafficUp)} · 下行 ${formatBytes(node.trafficDown)}`
    : "";

  return (
    <div className="compact-node-live-traffic" title={`流量 · ${traffic.typeLabel} · ${traffic.detail}${totalTitle}`}>
      <div className="compact-node-rate-stack">
        <CompactRate direction="up" rate={upRate} />
        <CompactRate direction="down" rate={downRate} />
      </div>
      <CompactTrafficPulse up={trafficTrend.up} down={trafficTrend.down} />
      <div className="compact-node-quota-pill" style={style}>
        <span className="compact-node-quota-fill" aria-hidden />
        <span className="compact-node-quota-content">
          <Database size={10} />
          <strong className="tabular">{traffic.compactDetail}</strong>
        </span>
      </div>
    </div>
  );
}

function resolveCardStatus(isOffline: boolean, rows: HomepagePingSourceRow[]) {
  if (isOffline || rows.some((row) => row.status === "critical")) return "critical";
  if (rows.some((row) => row.status === "warning" || row.status === "empty")) return "warning";
  return "ok";
}

export const CompactNodeCard = memo(function CompactNodeCard({ uuid }: { uuid: string }) {
  const model = useNodeCardModel(uuid);
  const themeSettings = useThemeSettings();

  if (!model.node) {
    return <div className="compact-node-card animate-pulse" aria-busy />;
  }

  const {
    node,
    traffic,
    trafficTrend,
    ping,
    compactFooterTags: footerTags,
    subtitle,
    renewalPrice,
    expire,
    expireColor,
    upRate,
    downRate,
    isOffline,
    loadFraction,
    hasHomepagePingBinding,
    osName,
  } = model;
  const showTrafficTotal = themeSettings.isReady && themeSettings.compactShowTrafficTotal;
  const showBilling = themeSettings.isReady && themeSettings.compactShowBilling;
  const showUptime = themeSettings.isReady && themeSettings.compactShowUptime;
  const showConnections = themeSettings.isReady && themeSettings.showConnections;
  const uptimeLabel = showUptime && !isOffline ? formatCompactUptime(node.uptime) : "";
  const sourceRows = buildHomepagePingSourceRows(ping, themeSettings.homepagePingTaskGroups, themeSettings.homepagePingTaskOrder[node.uuid]);
  const compareUrl = buildHomepagePingCompareUrl(uuid, ping.taskIds ?? []);
  const cardStatus = resolveCardStatus(isOffline, sourceRows);
  const emptyText = pingEmptyLabels(hasHomepagePingBinding).text;

  return (
    <article
      className={clsx("compact-node-card", isOffline && "is-offline")}
      data-status={cardStatus}
      data-online={node.online === true ? "true" : node.online === false ? "false" : "pending"}
    >
      <CompactNodeHeader node={node} osName={osName} isOffline={isOffline} />
      <CompactNodeMeta
        subtitle={subtitle}
        tags={footerTags}
        showBilling={showBilling}
        expire={expire}
        expireColor={expireColor}
        renewalPrice={renewalPrice}
        uptimeLabel={uptimeLabel}
        showConnections={showConnections}
        connections={node.connectionsTcp + node.connectionsUdp}
      />
      <CompactNodeVitals node={node} loadFraction={loadFraction} />
      <CompactLiveTraffic
        node={node}
        traffic={traffic}
        trafficTrend={trafficTrend}
        upRate={upRate}
        downRate={downRate}
        showTrafficTotal={showTrafficTotal}
      />
      {hasHomepagePingBinding && sourceRows.length > 0 ? (
        <PingSourceMatrix rows={sourceRows} compareUrl={compareUrl} density="compact" />
      ) : (
        <div className="compact-node-ping-empty">{emptyText}</div>
      )}
    </article>
  );
});
