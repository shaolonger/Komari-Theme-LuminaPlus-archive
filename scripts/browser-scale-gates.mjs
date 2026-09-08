import { createServer } from "node:http";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("../dist/", import.meta.url).pathname;
const chromeCandidates = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const chrome = chromeCandidates.find((candidate) => existsSync(candidate));
if (!chrome) throw new Error("Chrome/Chromium is required for browser scale gates");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
};
const BACKEND_PROFILES = Object.freeze({
  legacy: Object.freeze({
    id: "fork-rpc-v2.4",
    label: "fork RPC v2.4",
  }),
  official: Object.freeze({
    id: "official-komari-v1.4.3",
    label: "official Komari 1.4.3",
  }),
});

// `rpc.discover` is intentionally not listed here: upstream rejects that
// probe with -32601 so the client can negotiate `rpc.methods`. The calls
// below, by contrast, must never be made after a profile has been selected.
const LEGACY_ONLY_RPC_METHODS = [
  "common:getRealtimeDelta",
  "common:getPingOverview",
  "common:getRecords",
];
const OFFICIAL_ONLY_RPC_METHODS = [
  "rpc.methods",
  "common:getNodesLatestStatus",
  "public:getPublicPingTasks",
  "public:queryMetrics",
  "public:getPingMetricStats",
];
// The 1,800-request soak intentionally exercises the long-poll lifecycle,
// not a local-machine speed benchmark. GitHub hosted runners can take much
// longer than a desktop to schedule every React/network turn, so give the
// same workload a portable completion window instead of weakening the check.
const SOAK_TICK_TARGET = 1_800;
const SOAK_TIMEOUT_MS = 60_000;
// Startup is separate from the render/soak budgets. Hosted Linux runners may
// emit harmless DBus diagnostics and take several seconds before Chromium
// writes its DevTools endpoint, so wait for the actual endpoint rather than
// interpreting stderr as a startup signal.
const DEVTOOLS_STARTUP_TIMEOUT_MS = 30_000;

let activeFixture = {
  backend: BACKEND_PROFILES.legacy.id,
  nodes: 30,
  soak: false,
  run: "startup",
};
const requestCounts = new Map();
const requestPayloads = new Map();
let savedUiSettings = null;

function count(label, run = activeFixture.run) {
  const counts = requestCounts.get(run) ?? {};
  counts[label] = (counts[label] ?? 0) + 1;
  requestCounts.set(run, counts);
}

function recordRpcRequest(run, method, params) {
  count(`rpc:${method}`, run);
  const requests = requestPayloads.get(run) ?? [];
  requests.push({ method, params });
  requestPayloads.set(run, requests);
}

function isOfficialFixture(fixture) {
  return fixture.backend === BACKEND_PROFILES.official.id;
}

function nodeList(size) {
  return Array.from({ length: size }, (_, index) => ({
    uuid: `node-${index}`,
    name: `Scale Node ${index}`,
    group: `Group ${index % 8}`,
    region: `R${index % 16}`,
    hidden: false,
    mem_total: 2_147_483_648,
    disk_total: 21_474_836_480,
    weight: index,
    os: "linux",
    arch: "amd64",
    traffic_limit: 1_000_000_000_000,
  }));
}

function legacyReport(index, sequence) {
  return {
    online: true,
    cpu: { usage: (index + sequence) % 100 },
    ram: { used: 536_870_912 + ((index + sequence) % 100) * 1_048_576, total: 2_147_483_648 },
    swap: { used: 0, total: 0 },
    disk: { used: 5_368_709_120, total: 21_474_836_480 },
    load: { load1: 0.5, load5: 0.4, load15: 0.3 },
    network: {
      up: sequence * 100 + index,
      down: sequence * 120 + index,
      totalUp: sequence * 1_000 + index,
      totalDown: sequence * 2_000 + index,
    },
    connections: { tcp: 10, udp: 2 },
    uptime: sequence,
    process: 20,
    updated_at: 1_700_000_000 + sequence,
  };
}

// Upstream's common:getNodesLatestStatus intentionally returns a flat report
// map instead of the fork's nested RealtimeDelta shape. Keep the fixture on
// that wire format so this gate exercises the actual normalizer.
function officialLatestStatus(index, sequence) {
  return {
    online: true,
    cpu: (index + sequence) % 100,
    ram: 536_870_912 + ((index + sequence) % 100) * 1_048_576,
    ram_total: 2_147_483_648,
    swap: 0,
    swap_total: 0,
    disk: 5_368_709_120,
    disk_total: 21_474_836_480,
    load: 0.5,
    load5: 0.4,
    load15: 0.3,
    net_in: sequence * 120 + index,
    net_out: sequence * 100 + index,
    net_total_up: sequence * 1_000 + index,
    net_total_down: sequence * 2_000 + index,
    connections: 12,
    connections_udp: 2,
    uptime: sequence,
    process: 20,
    time: 1_700_000_000 + sequence,
  };
}

function toIsoOrNow(value) {
  const date = typeof value === "string" || typeof value === "number" ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

function requestedEntityIds(params, fixture) {
  const value = Array.isArray(params?.entity_ids) ? params.entity_ids : [];
  const allowed = new Set(nodeList(fixture.nodes).map((node) => node.uuid));
  const ids = value.filter((uuid) => typeof uuid === "string" && allowed.has(uuid));
  return ids.length > 0 ? ids : nodeList(fixture.nodes).map((node) => node.uuid);
}

function officialPingMetricSeries(params, fixture) {
  const metricKeys = Array.isArray(params?.metric_keys) ? params.metric_keys : [];
  const entityIds = requestedEntityIds(params, fixture);
  const end = new Date(toIsoOrNow(params?.end)).getTime();
  const start = new Date(toIsoOrNow(params?.start)).getTime();
  const windowStart = Number.isFinite(start) && start < end ? start : end - 3_600_000;
  const pointCount = Math.max(1, Math.min(24, Number(params?.max_points) || 24));
  const series = [];

  for (const metricKey of metricKeys) {
    if (metricKey !== "ping.latency_ms" && metricKey !== "ping.loss") continue;
    for (const [index, uuid] of entityIds.entries()) {
      const points = Array.from({ length: pointCount }, (_, point) => {
        const fraction = pointCount === 1 ? 1 : point / (pointCount - 1);
        const hasLoss = point === Math.floor(pointCount / 2);
        const count = hasLoss ? 2 : 1;
        return {
          time: new Date(windowStart + (end - windowStart) * fraction).toISOString(),
          value: metricKey === "ping.latency_ms"
            ? 20 + ((index + point) % 30)
            : hasLoss ? 0.5 : 0,
          count,
          tags: { task_id: "1" },
        };
      });
      series.push({
        metric_key: metricKey,
        entity_id: uuid,
        tags: { task_id: "1" },
        points,
      });
    }
  }

  return {
    start: new Date(windowStart).toISOString(),
    end: new Date(end).toISOString(),
    series,
    count: series.length,
  };
}

function officialPingStats(params, fixture) {
  const entityIds = requestedEntityIds(params, fixture);
  const start = toIsoOrNow(params?.start);
  const end = toIsoOrNow(params?.end);
  return {
    start,
    end,
    stats: entityIds.map((uuid, index) => ({
      entity_id: uuid,
      task_id: "1",
      name: "edge",
      type: "icmp",
      interval: 60,
      total: 60,
      valid: 59,
      loss: 1.67,
      loss_approximate: false,
      min: 10,
      max: 80,
      avg: 25 + (index % 3),
      latest: 20 + (index % 30),
      p99_p50_ratio: 1.2,
    })),
    count: entityIds.length,
  };
}

function sendJson(response, body) {
  response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function sendOfficialRestEnvelope(response, data) {
  sendJson(response, { status: "success", message: "ok", data });
}

function sendRpcResult(response, id, result) {
  sendJson(response, { jsonrpc: "2.0", id, result });
}

function sendRpcMethodMissing(response, id, method) {
  sendJson(response, {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `method not found: ${method}` },
  });
}

const server = createServer(async (request, response) => {
  // Capture the immutable fixture at request start. A navigation can switch
  // profiles while an older long-poll is still unwinding; it must not be
  // counted against, or answered as, the next profile's run.
  const fixture = activeFixture;
  const url = new URL(request.url ?? "/", "http://fixture.local");
  if (url.pathname === "/api/nodes") {
    count("nodes", fixture.run);
    const nodes = nodeList(fixture.nodes);
    return isOfficialFixture(fixture)
      ? sendOfficialRestEnvelope(response, nodes)
      : sendJson(response, nodes);
  }
  if (url.pathname === "/api/public") {
    count("public", fixture.run);
    const publicConfig = {
      sitename: "Komari Scale Gate",
      theme: "LuminaPlus",
      theme_settings: {
        showHomeOverview: false,
        showGroupTabs: false,
        desktopNodeViewMode: "compact",
        homepagePingBindings: { "1": nodeList(fixture.nodes).map((node) => node.uuid) },
        ...(fixture.ui ? { showGroupTabs: true, showPingChart: true } : {}),
        ...(fixture.ui ? savedUiSettings : {}),
      },
    };
    return isOfficialFixture(fixture)
      ? sendOfficialRestEnvelope(response, publicConfig)
      : sendJson(response, publicConfig);
  }
  if (url.pathname === "/api/me") {
    count("me", fixture.run);
    return sendJson(response, { logged_in: Boolean(fixture.ui), username: "test", uuid: "test" });
  }
  if (fixture.ui && url.pathname === "/api/admin/client/list") return sendJson(response, nodeList(fixture.nodes));
  if (fixture.ui && url.pathname === "/api/admin/ping") return sendJson(response, Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `Task ${index + 1}`, type: "icmp", interval: 60, clients: nodeList(fixture.nodes).map((node) => node.uuid) })));
  if (fixture.ui && url.pathname === "/api/admin/theme/settings") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    savedUiSettings = JSON.parse(Buffer.concat(chunks).toString());
    return sendJson(response, { status: "success" });
  }
  if (url.pathname === "/api/rpc2" && request.method === "POST") {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    recordRpcRequest(fixture.run, payload.method, payload.params);

    if (isOfficialFixture(fixture)) {
      if (payload.method === "rpc.discover") {
        return sendRpcMethodMissing(response, payload.id, payload.method);
      }
      if (payload.method === "rpc.methods") {
        return sendRpcResult(response, payload.id, [
          "common:getNodesLatestStatus",
          "public:getPublicPingTasks",
          "public:queryMetrics",
          "public:getPingMetricStats",
        ]);
      }
      if (payload.method === "common:getNodesLatestStatus") {
        const reports = Object.fromEntries(
          Array.from({ length: fixture.nodes }, (_, index) => [
            `node-${index}`,
            officialLatestStatus(index, 1),
          ]),
        );
        return sendRpcResult(response, payload.id, reports);
      }
      if (payload.method === "public:getPublicPingTasks") {
        if (fixture.ui) return sendRpcResult(response, payload.id, Array.from({ length: 6 }, (_, index) => ({ id: index + 1, name: `Task ${index + 1}`, weight: index, clients: nodeList(fixture.nodes).map((node) => node.uuid), default_on: true, type: "icmp", interval: 60 })));
        return sendRpcResult(response, payload.id, [{
          id: 1,
          weight: 1,
          name: "edge",
          clients: nodeList(fixture.nodes).map((node) => node.uuid),
          default_on: true,
          type: "icmp",
          interval: 60,
        }]);
      }
      if (payload.method === "public:queryMetrics") {
        return sendRpcResult(response, payload.id, officialPingMetricSeries(payload.params, fixture));
      }
      if (payload.method === "public:getPingMetricStats") {
        return sendRpcResult(response, payload.id, officialPingStats(payload.params, fixture));
      }
      return sendRpcMethodMissing(response, payload.id, payload.method);
    }

    if (payload.method === "rpc.discover") {
      return sendRpcResult(response, payload.id, {
        jsonrpc_version: "2.0",
        contract: "komari.rpc.v2.4",
        methods: ["common:getRealtimeDelta", "common:getPingOverview"],
        capabilities: { "realtime.delta": "1", "ping.overview": "2" },
      });
    }
    if (payload.method === "common:getRealtimeDelta") {
      const since = Number(payload.params?.since ?? 0);
      const sequence = since + 1;
      const reports = {};
      if (since === 0 || (fixture.soak && since < SOAK_TICK_TARGET)) {
        for (let index = 0; index < fixture.nodes; index += 1) {
          reports[`node-${index}`] = legacyReport(index, sequence);
        }
      }
      const result = {
        sequence,
        snapshot: since === 0,
        reports,
        online: since === 0 ? nodeList(fixture.nodes).map((node) => node.uuid) : undefined,
      };
      if (!fixture.soak && since > 0) await new Promise((resolve) => setTimeout(resolve, 250));
      if (fixture.soak && since >= SOAK_TICK_TARGET) await new Promise((resolve) => setTimeout(resolve, 250));
      return sendRpcResult(response, payload.id, result);
    }
    if (payload.method === "common:getPingOverview") {
      const to = Math.floor(Date.now() / 1_000);
      const stats = {};
      const series = {};
      for (let index = 0; index < fixture.nodes; index += 1) {
        const uuid = `node-${index}`;
        stats[uuid] = { "1": { name: "edge", total: 60, lost: 1, latest: 20 + (index % 30), avg: 25, tail: 0.2, loss: 1.67, min: 10, max: 80 } };
        series[uuid] = { "1": Array.from({ length: 24 }, (_, point) => ({
          time: to - (23 - point) * 150,
          value: 20 + ((index + point) % 30),
          sample_count: 2,
          loss_count: point === 11 ? 1 : 0,
          loss: point === 11 ? 50 : 0,
        })) };
      }
      return sendRpcResult(response, payload.id, {
        from: to - 3_600,
        to,
        tasks: [{ id: 1, name: "edge", type: "icmp", interval: 60 }],
        stats,
        series,
      });
    }
    return sendRpcMethodMissing(response, payload.id, payload.method);
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const safePath = normalize(join(ROOT, requested));
  const path = safePath.startsWith(normalize(ROOT)) && existsSync(safePath)
    ? safePath
    : join(ROOT, "index.html");
  response.writeHead(200, {
    "Content-Type": mime[extname(path)] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  createReadStream(path).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server did not bind TCP");
const profile = mkdtempSync(join(tmpdir(), "lumina-browser-gate-"));
const child = spawn(chrome, [
  "--headless=new",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-dev-shm-usage",
  "--disable-sync",
  "--remote-debugging-address=127.0.0.1",
  // Let Chromium select an unused port. It writes that port to
  // DevToolsActivePort in this isolated profile, avoiding a flaky random-port
  // collision on parallel CI jobs.
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let chromeErrors = "";
let chromeExit = null;
let chromeLaunchError = null;
child.stderr.on("data", (chunk) => { chromeErrors += chunk.toString(); });
child.once("exit", (code, signal) => { chromeExit = { code, signal }; });
child.once("error", (error) => { chromeLaunchError = error; });

function readDevToolsPort() {
  try {
    const [rawPort] = readFileSync(join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/, 1);
    const port = Number(rawPort);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  } catch {
    return null;
  }
}

async function waitForDebugger() {
  const deadline = Date.now() + DEVTOOLS_STARTUP_TIMEOUT_MS;
  let port = null;
  while (Date.now() < deadline) {
    if (chromeLaunchError) {
      throw new Error(`Chrome could not start: ${chromeLaunchError.message}`);
    }
    if (chromeExit) {
      const exit = chromeExit.code ?? chromeExit.signal ?? "unknown";
      throw new Error(`Chrome exited before DevTools started (${exit}): ${chromeErrors.slice(-1_000)}`);
    }
    port ??= readDevToolsPort();
    if (!port) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      continue;
    }
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json/list`, {
        signal: AbortSignal.timeout(1_000),
      }).then((result) => result.json());
      const page = pages.find((item) => item.type === "page" && !String(item.url).startsWith("chrome-extension:"));
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      // Chromium has written the port but has not exposed a page yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Chrome DevTools did not start within ${DEVTOOLS_STARTUP_TIMEOUT_MS}ms (port ${port ?? "not written"}): ${chromeErrors.slice(-1_000)}`,
  );
}

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 0;
    this.pending = new Map();
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
  }
  call(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async value(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket.close(); }
}

async function waitUntil(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cdp.value(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const diagnostics = await cdp.value(`({
    text: document.body?.innerText?.slice(0, 600),
    cards: document.querySelectorAll('.home-node-card-slot').length,
    rows: document.querySelectorAll('.node-list-row').length,
    url: location.href
  })`);
  throw new Error(`browser condition timed out: ${expression}; ${JSON.stringify(diagnostics)}`);
}

// The legacy fixture holds one long-poll request open. Tear down the previous
// document before switching `activeFixture`, otherwise a late request emitted
// by the old page can be attributed to the next backend profile and turn a
// real protocol assertion into a cross-navigation race.
async function clearFixturePage(cdp) {
  await cdp.call("Page.navigate", { url: "about:blank" });
  await waitUntil(cdp, "location.href === 'about:blank'", 2_000);
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function failGate(condition, message) {
  if (!condition) throw new Error(message);
}

function rpcRequests(run, method) {
  return (requestPayloads.get(run) ?? []).filter((entry) => entry.method === method);
}

function assertNoRpcRequests(run, profileLabel, methods) {
  const requests = requestPayloads.get(run) ?? [];
  for (const method of methods) {
    const countForMethod = requests.filter((entry) => entry.method === method).length;
    failGate(
      countForMethod === 0,
      `${profileLabel} made incompatible RPC call ${method} (${countForMethod}x)`,
    );
  }
}

function assertOneNodeBatch(run, profileLabel, method, paramKey, nodes) {
  const requests = rpcRequests(run, method);
  failGate(
    requests.length === 1,
    `${profileLabel} expected one batched ${method} request, got ${requests.length}`,
  );
  const ids = requests[0]?.params?.[paramKey];
  failGate(
    Array.isArray(ids),
    `${profileLabel} ${method} did not send ${paramKey} as an array`,
  );
  const expected = new Set(Array.from({ length: nodes }, (_, index) => `node-${index}`));
  const actual = new Set(ids);
  failGate(
    actual.size === expected.size && [...expected].every((uuid) => actual.has(uuid)),
    `${profileLabel} ${method} was not a complete ${nodes}-node batch`,
  );
}

function assertLegacyRequestProfile(run, nodes) {
  const profileLabel = BACKEND_PROFILES.legacy.label;
  const counts = requestCounts.get(run) ?? {};
  if ((counts.nodes ?? 0) !== 1) {
    throw new Error(`${profileLabel} ${nodes}-node /api/nodes count=${counts.nodes ?? 0}`);
  }
  if ((counts["rpc:common:getPingOverview"] ?? 0) > 1) {
    throw new Error(`${profileLabel} ${nodes}-node Ping overview fanned out`);
  }
  assertNoRpcRequests(run, profileLabel, OFFICIAL_ONLY_RPC_METHODS);
}

function assertOfficialRequestProfile(run, nodes) {
  const profileLabel = BACKEND_PROFILES.official.label;
  const counts = requestCounts.get(run) ?? {};
  if ((counts.nodes ?? 0) !== 1) {
    throw new Error(`${profileLabel} ${nodes}-node /api/nodes count=${counts.nodes ?? 0}`);
  }

  // The failed discovery probe is required by capability negotiation. After
  // it, all data must come from upstream's batch current-status/metric APIs.
  failGate(
    rpcRequests(run, "rpc.discover").length === 1,
    `${profileLabel} expected one rpc.discover negotiation probe`,
  );
  failGate(
    rpcRequests(run, "rpc.methods").length === 1,
    `${profileLabel} expected one rpc.methods capability request`,
  );
  assertOneNodeBatch(run, profileLabel, "common:getNodesLatestStatus", "uuids", nodes);
  assertOneNodeBatch(run, profileLabel, "public:queryMetrics", "entity_ids", nodes);
  assertOneNodeBatch(run, profileLabel, "public:getPingMetricStats", "entity_ids", nodes);
  failGate(
    rpcRequests(run, "public:getPublicPingTasks").length === 1,
    `${profileLabel} expected one public:getPublicPingTasks request`,
  );

  const metricParams = rpcRequests(run, "public:queryMetrics")[0]?.params ?? {};
  const metricKeys = metricParams.metric_keys;
  failGate(
    Array.isArray(metricKeys) &&
      metricKeys.includes("ping.latency_ms") &&
      metricKeys.includes("ping.loss") &&
      Number(metricParams.max_points) === 24,
    `${profileLabel} Ping metric request did not use the shared 24-point trend batch`,
  );
  failGate(
    Number(rpcRequests(run, "public:getPingMetricStats")[0]?.params?.max_points) === 24,
    `${profileLabel} Ping statistics request did not use the shared 24-point trend batch`,
  );
  assertNoRpcRequests(run, profileLabel, LEGACY_ONLY_RPC_METHODS);
}

const results = [];
let cdp;
try {
  cdp = new CDP(await waitForDebugger());
  await cdp.open();
  await cdp.call("Page.enable");
  await cdp.call("Runtime.enable");
  await cdp.call("HeapProfiler.enable");

  for (const backend of Object.values(BACKEND_PROFILES)) {
    for (const [nodes, budgetMs] of [[30, 4_000], [300, 6_000], [1_000, 12_000]]) {
      const run = `${backend.id}-scale-${nodes}`;
      await clearFixturePage(cdp);
      activeFixture = { backend: backend.id, nodes, soak: false, run };
      requestCounts.set(run, {});
      requestPayloads.set(run, []);
      await cdp.call("Page.navigate", {
        url: `http://127.0.0.1:${address.port}/?fixture=${nodes}&backend=${backend.id}`,
      });
      await waitUntil(cdp, `document.querySelectorAll('.home-node-card-slot').length === ${nodes}`, budgetMs);
      await waitUntil(cdp, "document.querySelectorAll('.ping-task-sparkline-line').length > 0", budgetMs);
      const metrics = await cdp.value(`(() => ({
      renderMs: performance.now(),
      cards: document.querySelectorAll('.home-node-card-slot').length,
      canvases: document.querySelectorAll('canvas').length,
      activeCanvases: document.querySelectorAll('canvas[data-render-active="true"]').length,
      pingTrendLines: document.querySelectorAll('.ping-task-sparkline-line').length,
      emptyPingTrends: document.querySelectorAll('.ping-task-sparkline-empty').length,
      contentVisibility: getComputedStyle(document.querySelector('.home-node-card-slot')).contentVisibility,
      bodyWidth: document.body.scrollWidth
    }))()`);
      if (metrics.renderMs > budgetMs) throw new Error(`${backend.label} ${nodes}-node render ${metrics.renderMs}ms > ${budgetMs}ms`);
      if (nodes >= 300 && metrics.contentVisibility !== "auto") {
        throw new Error(`${backend.label} ${nodes}-node browser card virtualization is disabled`);
      }
      if (nodes >= 300 && metrics.canvases > 0 && metrics.activeCanvases >= metrics.canvases) {
        throw new Error(`${backend.label} ${nodes}-node browser did not suspend offscreen canvases`);
      }
      if (metrics.pingTrendLines === 0 || metrics.emptyPingTrends !== 0) {
        throw new Error(`${backend.label} ${nodes}-node Ping trend regression: lines=${metrics.pingTrendLines}, empty=${metrics.emptyPingTrends}`);
      }
      if (backend === BACKEND_PROFILES.legacy) assertLegacyRequestProfile(run, nodes);
      else assertOfficialRequestProfile(run, nodes);
      results.push({ backend: backend.id, nodes, ...metrics, requests: requestCounts.get(run) ?? {} });
    }
  }

  const soakRun = `${BACKEND_PROFILES.legacy.id}-soak-30`;
  await clearFixturePage(cdp);
  activeFixture = {
    backend: BACKEND_PROFILES.legacy.id,
    nodes: 30,
    soak: true,
    run: soakRun,
  };
  requestCounts.set(activeFixture.run, {});
  requestPayloads.set(activeFixture.run, []);
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?fixture=30&soak=1&backend=${BACKEND_PROFILES.legacy.id}` });
  await waitUntil(cdp, "document.querySelectorAll('.home-node-card-slot').length === 30", 4_000);
  await cdp.call("HeapProfiler.collectGarbage");
  const heapBefore = await cdp.call("Runtime.getHeapUsage");
  const soakDeadline = Date.now() + SOAK_TIMEOUT_MS;
  while ((requestCounts.get(soakRun)?.["rpc:common:getRealtimeDelta"] ?? 0) < SOAK_TICK_TARGET && Date.now() < soakDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const completedSoakTicks = requestCounts.get(soakRun)?.["rpc:common:getRealtimeDelta"] ?? 0;
  if (completedSoakTicks < SOAK_TICK_TARGET) {
    throw new Error(`browser soak did not finish: ${completedSoakTicks}/${SOAK_TICK_TARGET} long-poll turns in ${SOAK_TIMEOUT_MS}ms`);
  }
  await cdp.call("HeapProfiler.collectGarbage");
  const heapAfter = await cdp.call("Runtime.getHeapUsage");
  const heapGrowth = heapAfter.usedSize - heapBefore.usedSize;
  if (heapGrowth > 16 * 1024 * 1024) throw new Error(`browser soak heap grew ${heapGrowth} bytes`);
  assertLegacyRequestProfile(soakRun, 30);
  results.push({ backend: BACKEND_PROFILES.legacy.id, soakTicks: SOAK_TICK_TARGET, heapBefore: heapBefore.usedSize, heapAfter: heapAfter.usedSize, heapGrowth });

  await clearFixturePage(cdp);
  activeFixture = { backend: BACKEND_PROFILES.official.id, nodes: 3, soak: false, run: "ui-regressions", ui: true };
  await cdp.call("Emulation.setDeviceMetricsOverride", { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/instance/node-0` });
  await waitUntil(cdp, `Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Ping')`, 6_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Ping').click()`);
  await waitUntil(cdp, `document.querySelector('.instance-ping-task') !== null`, 6_000);
  for (const label of ["6 小时", "1 天", "自定义"]) {
    await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`);
    await waitUntil(cdp, `document.querySelector('.instance-chart-view:not([hidden]) .uplot canvas') !== null`, 6_000);
    if (label === "1 天" && process.env.BROWSER_GATE_SCREENSHOT) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
      writeFileSync(`${process.env.BROWSER_GATE_SCREENSHOT}.ping.png`, Buffer.from(screenshot.data, "base64"));
    }
  }
  await waitUntil(cdp, `document.querySelectorAll('input[type="datetime-local"]').length === 2`, 2_000);
  await cdp.value(`(() => {
    const inputs = document.querySelectorAll('input[type="datetime-local"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(inputs[0], '2026-08-01T18:00'); inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    setter.call(inputs[1], '2026-08-02T00:00'); inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '应用时间范围').click()`);
  await new Promise((resolve) => setTimeout(resolve, 300));
  failGate(rpcRequests("ui-regressions", "public:queryMetrics").some(({ params }) => params.start === "2026-08-01T10:00:00.000Z" && params.end === "2026-08-01T16:00:00.000Z"), "custom Ping range was not sent in Beijing time");
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/?view=theme-manage` });
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索要配置的 VPS"]') !== null`, 6_000);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '选择当前结果').click()`);
  await waitUntil(cdp, `document.body.innerText.includes('批量配置 3 台 VPS')`, 2_000);
  await cdp.value(`(() => { const title = Array.from(document.querySelectorAll('strong')).find(e => e.textContent === '批量配置 3 台 VPS'); title.parentElement.querySelectorAll('input[type="checkbox"]').forEach(e => e.click()); })()`);
  await cdp.value(`document.querySelector('button[aria-label="上移 Task 6"]').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '替换所选 VPS 的任务').click()`);
  await cdp.value(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '保存设置').click()`);
  await waitUntil(cdp, `document.body.innerText.includes('保存成功') || document.body.innerText.includes('已保存')`, 6_000);
  failGate(Object.values(savedUiSettings?.homepagePingTaskOrder ?? {}).filter(ids => ids.length === 6).length === 3, "batch VPS task configuration was not saved");
  failGate(savedUiSettings.homepagePingTaskOrder["node-0"].join() === "1,2,3,4,6,5", "configured order was lost on save");
  await cdp.call("Page.reload");
  await waitUntil(cdp, `document.querySelector('input[aria-label="搜索要配置的 VPS"]') !== null && document.body.innerText.includes('Task 4 → Task 6 → Task 5')`, 6_000);
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    await cdp.value(`document.querySelector('input[aria-label="搜索要配置的 VPS"]').scrollIntoView({ block: 'start' })`);
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${process.env.BROWSER_GATE_SCREENSHOT}.editor.png`, Buffer.from(screenshot.data, "base64"));
  }
  await cdp.call("Page.navigate", { url: `http://127.0.0.1:${address.port}/` });
  await waitUntil(cdp, `document.querySelectorAll('.ping-task-lane').length === 18`, 6_000);
  failGate(await cdp.value(`Array.from(document.querySelectorAll('.home-node-card-slot')[0].querySelectorAll('.ping-task-lane-name')).map(e => e.textContent).join() === 'Task 1,Task 2,Task 3,Task 4,Task 6,Task 5'`), "card did not preserve all six configured tasks in order");
  const facetBefore = await cdp.value(`Array.from(document.querySelectorAll('.home-facet-rail button')).map(e => e.textContent)`);
  await cdp.value(`Array.from(document.querySelectorAll('.home-facet-rail button')).find(e => e.textContent.includes('Group 2')).click()`);
  failGate(JSON.stringify(await cdp.value(`Array.from(document.querySelectorAll('.home-facet-rail button')).map(e => e.textContent)`)) === JSON.stringify(facetBefore), "selected facet moved from its position");
  if (process.env.BROWSER_GATE_SCREENSHOT) {
    const screenshot = await cdp.call("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.env.BROWSER_GATE_SCREENSHOT, Buffer.from(screenshot.data, "base64"));
  }
  results.push({ uiRegressions: "Ping presets, Beijing custom range, VPS batch save/reload, six-task order, stable facets" });
  console.log(JSON.stringify(results, null, 2));
} finally {
  cdp?.close();
  if (!chromeExit) {
    await new Promise((resolve) => {
      const onExit = () => resolve();
      child.once("exit", onExit);
      if (chromeExit) {
        child.off("exit", onExit);
        resolve();
        return;
      }
      child.kill("SIGTERM");
    });
  }
  server.close();
  rmSync(profile, { recursive: true, force: true });
}
