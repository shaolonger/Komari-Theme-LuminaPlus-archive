import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "contracts", "backend-profiles", "official-komari-v1.4.3.json");
const serverDir = process.env.KOMARI_UPSTREAM_DIR;
const agentDir = process.env.KOMARI_AGENT_UPSTREAM_DIR;

function fail(message) {
  throw new Error(`official upstream surface check failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`cannot parse ${path.relative(root, file)}: ${error.message}`);
  }
}

function requireDirectory(value, variable) {
  assert(typeof value === "string" && value.trim(), `set ${variable} to an audited upstream checkout`);
  const directory = path.resolve(value);
  assert(fs.statSync(directory, { throwIfNoEntry: false })?.isDirectory(),
    `${variable} is not a directory: ${directory}`);
  return directory;
}

function gitHead(directory, label) {
  try {
    return execFileSync("git", ["-C", directory, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch (error) {
    fail(`cannot read ${label} HEAD: ${error.message}`);
  }
}

function gitRemote(directory, label) {
  try {
    return execFileSync("git", ["-C", directory, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  } catch (error) {
    fail(`cannot read ${label} origin remote: ${error.message}`);
  }
}

function normalizeGithubRemote(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/i, "https://github.com/")
    .replace(/\.git$/i, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

function readSource(directory, relativePath) {
  const file = path.join(directory, relativePath);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    fail(`cannot read ${relativePath}: ${error.message}`);
  }
}

function expectAll(source, file, markers) {
  for (const marker of markers) {
    assert(source.includes(marker), `${file} is missing ${JSON.stringify(marker)}`);
  }
}

const manifest = readJson(manifestPath);
const sourceAudit = manifest.source?.audited_main;
const agentAudit = manifest.agent?.audited_main;
assert(sourceAudit?.ref === "main" && /^[0-9a-f]{40}$/.test(sourceAudit?.commit ?? ""),
  "official profile must declare a full current-main server audit SHA");
assert(agentAudit?.ref === "main" && /^[0-9a-f]{40}$/.test(agentAudit?.commit ?? ""),
  "official profile must declare a full current-main agent audit SHA");

const server = requireDirectory(serverDir, "KOMARI_UPSTREAM_DIR");
const agent = requireDirectory(agentDir, "KOMARI_AGENT_UPSTREAM_DIR");
assert(normalizeGithubRemote(gitRemote(server, "Komari server"))
  === normalizeGithubRemote(manifest.source.repository),
`Komari server origin must be ${manifest.source.repository}`);
assert(normalizeGithubRemote(gitRemote(agent, "Komari agent"))
  === normalizeGithubRemote(manifest.agent.repository),
`Komari agent origin must be ${manifest.agent.repository}`);
assert(gitHead(server, "Komari server") === sourceAudit.commit,
  `Komari server checkout must be ${sourceAudit.commit}`);
assert(gitHead(agent, "Komari agent") === agentAudit.commit,
  `Komari agent checkout must be ${agentAudit.commit}`);

expectAll(readSource(server, "web/rpc/jsonrpc/common.go"), "web/rpc/jsonrpc/common.go", [
  'RegisterWithGroupAndMeta("getNodesLatestStatus", "common",',
  'UUIDs []string `json:"uuids"`',
  "appendOne := func(uuid string, rep *v2.Report)",
  'NetIn          int64               `json:"net_in"`',
  'NetOut         int64               `json:"net_out"`',
  'NetTotalUp     int64               `json:"net_total_up"`',
  'NetTotalDown   int64               `json:"net_total_down"`',
  'Online         bool                `json:"online"`',
  "Online:         onlineSet[uuid],",
]);

expectAll(readSource(server, "pkg/rpc/internal.go"), "pkg/rpc/internal.go", [
  'registerInternal("rpc.methods",',
  'ShowInternal bool `json:"internal"`',
  "return listMethods(params.ShowInternal), nil",
]);

expectAll(readSource(server, "web/rpc/jsonrpc/public.go"), "web/rpc/jsonrpc/public.go", [
  'regPublic("getNodesInformation", publicGetNodesInformation',
  'regPublic("getPublicPingTasks", publicGetPublicPingTasks',
  'Clients   []string `json:"clients"`',
  'DefaultOn bool     `json:"default_on"`',
  'Interval  int      `json:"interval"`',
]);

expectAll(readSource(server, "web/rpc/jsonrpc/public.metric.go"), "web/rpc/jsonrpc/public.metric.go", [
  'regPublic("queryMetrics", publicQueryMetrics',
  'regPublic("getPingMetricStats", publicGetPingMetricStats',
  'MetricKeys []string `json:"metric_keys"`',
  'EntityIDs []string `json:"entity_ids"`',
  'AggregationByMetric map[string]string `json:"aggregation_by_metric"`',
  'Count    int               `json:"count,omitempty"`',
  "params.AggregationByMetric[metricKey]",
  "Count:    point.Count,",
]);

expectAll(readSource(server, "internal/metricstore/metrics.go"), "internal/metricstore/metrics.go", [
  'MetricCPU            = "cpu.usage"',
  'MetricRAM            = "memory.used"',
  'MetricSwap           = "swap.used"',
  'MetricLoad           = "load.average"',
  'MetricDisk           = "disk.used"',
  'MetricNetIn          = "net.in.rate"',
  'MetricNetOut         = "net.out.rate"',
  'MetricNetTotalUp     = "net.total.up"',
  'MetricNetTotalDown   = "net.total.down"',
  'MetricPingLatency    = "ping.latency_ms"',
  'MetricPingLoss       = "ping.loss"',
]);

expectAll(readSource(server, "internal/metricstore/ping_records.go"), "internal/metricstore/ping_records.go", [
  "if rec.Value < 0 {",
  "loss = 1",
  "MetricName: MetricPingLatency",
  "MetricName: MetricPingLoss",
]);

expectAll(readSource(server, "database/models/pingTask.go"), "database/models/pingTask.go", [
  "func (task PingTask) AppliesToClient(uuid string) bool",
  "for _, client := range task.Clients {",
  "if client == uuid {",
]);

expectAll(readSource(server, "web/router/router.go"), "web/router/router.go", [
  'r.GET("/api/me", jsonRpc.Bind("public:getMe", jsonRpc.WithRaw()))',
  'r.GET("/api/nodes", jsonRpc.Bind("public:getNodesInformation"))',
  'r.GET("/api/public", jsonRpc.Bind("public:getPublicSettings"))',
  'r.GET("/api/rpc2", jsonRpc.OnRpcRequest)',
  'r.POST("/api/rpc2", jsonRpc.OnRpcRequest)',
  'clientGroup.GET("/list", jsonRpc.Bind("admin:listClients", jsonRpc.WithRaw()))',
  'pingTask.GET("/", jsonRpc.Bind("admin:getAllPingTasks"))',
  'theme.POST("/settings", admin.UpdateThemeSettings)',
  'tokenAuthorized.GET("/v2/rpc", client.WebSocketV2RPC)',
  'tokenAuthorized.POST("/v2/rpc", client.UploadV2RPC)',
]);

expectAll(readSource(server, "web/rpc/jsonrpc/bridge.go"), "web/rpc/jsonrpc/bridge.go", [
  "cfg := &bindConfig{render: renderStandard}",
  "case renderRaw:",
  'out := gin.H{"status": "success", "message": cfg.successMsg}',
]);

expectAll(readSource(server, "web/api/admin/theme.go"), "web/api/admin/theme.go", [
  "func UpdateThemeSettings(c *gin.Context)",
  "var req map[string]any",
  "c.ShouldBindJSON(&req)",
  "api.RespondSuccess(c, nil)",
]);

expectAll(readSource(server, "web/api/client/report_v2.go"), "web/api/client/report_v2.go", [
  "if req.JSONRPC != v2.Version {",
  "case v2.MethodAgentReport:",
  "var params v2.ReportParams",
  "ingestReport(uuid, params.Report, true)",
  "case v2.MethodAgentPingResult:",
  "ingestPingResult(uuid, params.TaskID, params.Value)",
]);

expectAll(readSource(server, "protocol/v2/jsonrpc.go"), "protocol/v2/jsonrpc.go", [
  'Version               = "2.0"',
  'MethodAgentReport     = "agent.report"',
  "type ReportParams struct {",
  'Report      Report   `json:"report"`',
  "type NetworkReport struct {",
  'TotalUp   int64 `json:"totalUp"`',
  'TotalDown int64 `json:"totalDown"`',
]);

expectAll(readSource(server, "web/public/public.go"), "web/public/public.go", [
  "distPath := path.Join(DistDir, reqPath)",
  "getFileContent(currentTheme, distPath)",
]);

expectAll(readSource(agent, "protocol/v2/jsonrpc.go"), "protocol/v2/jsonrpc.go", [
  'Version               = "2.0"',
  'MethodAgentReport     = "agent.report"',
  "func BuildReportPayload(report []byte) []byte",
  "return NewNotification(MethodAgentReport, reportParams{Report: json.RawMessage(report)})",
]);

expectAll(readSource(agent, "server/websocket.go"), "server/websocket.go", [
  "v2.BuildReportPayload(monitoring.GenerateReport())",
  '"/api/clients/v2/rpc?token="',
  "v2.BuildReportRequest(reportID, monitoring.GenerateReport(), ackIDs)",
]);

expectAll(readSource(agent, "monitoring/monitoring.go"), "monitoring/monitoring.go", [
  "func GenerateReport() []byte",
  "data.Network = networkReport{",
]);

console.log(`verified official Komari main ${sourceAudit.commit} and agent main ${agentAudit.commit}`);
