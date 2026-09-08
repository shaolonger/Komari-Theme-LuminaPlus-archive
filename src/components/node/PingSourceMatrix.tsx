import { useMemo, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { BarChart3 } from "lucide-react";
import type { HomepagePingSourceRow } from "@/utils/homepagePingSources";
import { HOMEPAGE_PING_WINDOW_HOURS } from "@/utils/homepagePingOverview";
import { formatLatencyValue, formatMetricNumber } from "@/utils/format";
import { latencyHeatColor } from "@/utils/metricTone";
import { buildPingSparklineGeometry } from "@/utils/pingSparkline";
import { buildPingTaskVpsCompareUrl } from "@/utils/pingCompareLink";

const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 22;

function sourceMeta(source: HomepagePingSourceRow) {
  return source.group || source.target || `ID ${source.taskId}`;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[center];
  return (sorted[center - 1] + sorted[center]) / 2;
}

function PingTaskSparkline({
  source,
}: {
  source: HomepagePingSourceRow;
}) {
  const geometry = useMemo(
    () => buildPingSparklineGeometry(source.samples),
    [source.samples],
  );
  const lineColor = latencyHeatColor(source.latencyMs);
  const style = { "--ping-task-line": lineColor } as CSSProperties;

  if (geometry.paths.length === 0 && geometry.lossMarkers.length === 0) {
    return <span className="ping-task-sparkline-empty">暂无趋势</span>;
  }

  return (
    <svg
      className="ping-task-sparkline"
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      style={style}
      aria-hidden
    >
      <path className="ping-task-sparkline-baseline" d={`M 0 20.5 L ${SPARKLINE_WIDTH} 20.5`} />
      {geometry.paths.map((path, index) => (
        <path key={`${source.taskId}-${index}`} className="ping-task-sparkline-line" d={path} />
      ))}
      {geometry.lossMarkers.map((x, index) => (
        <line
          key={`${source.taskId}-loss-${index}`}
          className="ping-task-sparkline-loss"
          x1={x}
          x2={x}
          y1="1"
          y2={SPARKLINE_HEIGHT - 1}
        />
      ))}
    </svg>
  );
}

function PingTaskTile({
  source,
  density,
}: {
  source: HomepagePingSourceRow;
  density: "regular" | "compact";
}) {
  const latencyColor = latencyHeatColor(source.latencyMs);
  const hasLoss = (source.lossPercent ?? 0) > 0;
  return (
    <article
      className="ping-task-tile"
      data-status={source.status}
      data-loss={hasLoss ? "true" : "false"}
      title={source.title}
    >
      <div className="ping-task-tile-head">
        <Link
          to={buildPingTaskVpsCompareUrl({
            taskId: source.taskId,
            hours: HOMEPAGE_PING_WINDOW_HOURS,
          })}
          className="ping-task-name"
          title="对比该任务下的 VPS"
        >
          {source.name}
        </Link>
        <span className="ping-task-readings tabular">
          <strong style={{ color: latencyColor }}>
            {source.latencyShortLabel}
            {source.latencyMs != null && <small>ms</small>}
          </strong>
          <i aria-hidden />
          <strong className="ping-task-loss-value">
            {source.lossShortLabel}
            {source.lossPercent != null && <small>%</small>}
          </strong>
        </span>
      </div>
      {density === "regular" && <small className="ping-task-meta">{sourceMeta(source)}</small>}
      <PingTaskSparkline source={source} />
    </article>
  );
}

function CompactPingTaskLane({ source }: { source: HomepagePingSourceRow }) {
  const latencyColor = latencyHeatColor(source.latencyMs);
  const hasLoss = (source.lossPercent ?? 0) > 0;

  return (
    <article
      className="ping-task-lane"
      data-status={source.status}
      data-loss={hasLoss ? "true" : "false"}
      title={source.title}
    >
      <Link
        to={buildPingTaskVpsCompareUrl({
          taskId: source.taskId,
          hours: HOMEPAGE_PING_WINDOW_HOURS,
        })}
        className="ping-task-lane-name"
        title="对比该任务下的 VPS"
      >
        {source.name}
      </Link>
      <strong className="ping-task-lane-latency tabular" style={{ color: latencyColor }}>
        {source.latencyShortLabel}
        {source.latencyMs != null && <small>ms</small>}
      </strong>
      <PingTaskSparkline source={source} />
      <strong className="ping-task-lane-loss tabular">
        {source.lossShortLabel}
        {source.lossPercent != null && <small>%</small>}
      </strong>
    </article>
  );
}

export function PingSourceMatrix({
  rows,
  compareUrl,
  density = "regular",
}: {
  rows: HomepagePingSourceRow[];
  compareUrl: string;
  density?: "regular" | "compact";
}) {
  if (rows.length === 0) return null;

  const visibleRows = rows;
  const latencyValues = rows
    .map((row) => row.latencyMs)
    .filter((value): value is number => value != null);
  const lossValues = rows
    .map((row) => row.lossPercent)
    .filter((value): value is number => value != null);
  const medianLatency = median(latencyValues);
  const worstLatency = latencyValues.length > 0 ? Math.max(...latencyValues) : null;
  const maxLoss = lossValues.length > 0 ? Math.max(...lossValues) : null;
  const compact = density === "compact";

  return (
    <section className="ping-source-matrix" data-density={density}>
      {density === "regular" && (
        <header className="ping-source-matrix-head">
          <span className="ping-source-matrix-title">
            监测任务
            <b>{rows.length}</b>
          </span>
          <span className="ping-source-summary" aria-label="Ping 聚合摘要">
            <span>
              中位 <strong>{medianLatency == null ? "—" : `${formatLatencyValue(medianLatency)} ms`}</strong>
            </span>
            <span>
              最差 <strong>{worstLatency == null ? "—" : `${formatLatencyValue(worstLatency)} ms`}</strong>
            </span>
            <span>
              max 丢包 <strong>{maxLoss == null ? "—" : `${formatMetricNumber(maxLoss)}%`}</strong>
            </span>
          </span>
          <Link to={compareUrl} className="ping-source-matrix-link">
            <BarChart3 size={12} strokeWidth={2.1} />
            <span>对比</span>
          </Link>
        </header>
      )}
      <div className={compact ? "ping-source-lanes" : "ping-source-list"}>
        {visibleRows.map((source) => (
          compact ? (
            <CompactPingTaskLane key={source.taskId} source={source} />
          ) : (
            <PingTaskTile key={source.taskId} source={source} density={density} />
          )
        ))}
      </div>
    </section>
  );
}
