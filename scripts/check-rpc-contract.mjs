import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilesDir = path.join(root, "contracts", "backend-profiles");
const generatedContractPath = path.join(root, "src", "generated", "rpcContract.ts");
const backendProfilePath = path.join(root, "src", "services", "backendProfile.ts");

const expectedProfiles = [
  { file: "legacy-rpc-v2.4.json", kind: "fork-v2.4" },
  { file: "official-komari-v1.4.3.json", kind: "official-v1.4" },
];

function fail(message) {
  throw new Error(`backend profile contract check failed: ${message}`);
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

function requireString(value, description) {
  assert(typeof value === "string" && value.trim().length > 0, `${description} must be a non-empty string`);
  return value;
}

function requireObject(value, description) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${description} must be an object`);
  return value;
}

function requireStringArray(value, description) {
  assert(Array.isArray(value), `${description} must be an array`);
  for (const item of value) requireString(item, `${description} entry`);
  assert(new Set(value).size === value.length, `${description} must not contain duplicate methods`);
  return value;
}

function requireAuditRef(value, description) {
  const audit = requireObject(value, description);
  assert(audit.ref === "main", `${description}.ref must be main`);
  assert(typeof audit.commit === "string" && /^[0-9a-f]{40}$/.test(audit.commit),
    `${description}.commit must be a full lowercase Git SHA`);
  assert(typeof audit.checked_at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(audit.checked_at),
    `${description}.checked_at must be an ISO date`);
  return audit;
}

function quotedStrings(source) {
  return [...source.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
}

function extractStringArray(source, name) {
  const match = source.match(new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s+as const`));
  assert(match, `could not locate ${name} in generated source`);
  return quotedStrings(match[1]);
}

function extractStringMap(source, name) {
  const match = source.match(new RegExp(`(?:const|export const)\\s+${name}\\s*=\\s*\\{([\\s\\S]*?)\\}\\s+as const`));
  assert(match, `could not locate ${name} in generated source`);
  const values = {};
  for (const entry of match[1].matchAll(/^\s*"([^"]+)"\s*:\s*"([^"]+)"\s*,?\s*$/gm)) {
    values[entry[1]] = entry[2];
  }
  return values;
}

function assertSameStringSet(actual, expected, description) {
  const missing = expected.filter((item) => !actual.includes(item));
  const unexpected = actual.filter((item) => !expected.includes(item));
  assert(missing.length === 0 && unexpected.length === 0,
    `${description} differs (missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"})`);
}

function assertSameStringMap(actual, expected, description) {
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
  const differences = [...keys]
    .filter((key) => actual[key] !== expected[key])
    .map((key) => `${key}=${JSON.stringify(actual[key])}/${JSON.stringify(expected[key])}`);
  assert(differences.length === 0, `${description} differs (${differences.join(", ")})`);
}

function validateManifest(profile, expected) {
  const prefix = `profile ${expected.file}`;
  assert(profile.schema_version === 1, `${prefix} has unsupported schema_version`);
  assert(profile.kind === expected.kind, `${prefix} kind must be ${expected.kind}`);
  requireString(profile.label, `${prefix}.label`);

  const source = requireObject(profile.source, `${prefix}.source`);
  requireString(source.repository, `${prefix}.source.repository`);

  const discovery = requireObject(profile.discovery, `${prefix}.discovery`);
  const discoveryMethod = requireString(discovery.method, `${prefix}.discovery.method`);
  requireObject(discovery.params, `${prefix}.discovery.params`);
  requireObject(discovery.response, `${prefix}.discovery.response`);

  const methods = requireStringArray(profile.required_methods, `${prefix}.required_methods`);
  assert(methods.includes(discoveryMethod), `${prefix} must declare its discovery method as required`);
  return { discovery, methods };
}

const profiles = new Map();
for (const expected of expectedProfiles) {
  const file = path.join(profilesDir, expected.file);
  assert(fs.existsSync(file), `missing ${path.relative(root, file)}`);
  const profile = readJson(file);
  profiles.set(expected.kind, { profile, ...validateManifest(profile, expected) });
}

const legacy = profiles.get("fork-v2.4");
const official = profiles.get("official-v1.4");
assert(legacy && official, "required backend profiles are unavailable");

const generated = fs.readFileSync(generatedContractPath, "utf8");
const backendProfileSource = fs.readFileSync(backendProfilePath, "utf8");

const legacyContract = legacy.discovery.response.contract;
const legacyJsonrpcVersion = legacy.discovery.response.jsonrpc_version;
const legacyCapabilities = requireObject(legacy.profile.capabilities, "legacy profile capabilities");
requireString(legacyContract, "legacy profile discovery contract");
requireString(legacyJsonrpcVersion, "legacy profile discovery JSON-RPC version");
for (const [name, version] of Object.entries(legacyCapabilities)) {
  requireString(name, "legacy profile capability name");
  requireString(version, `legacy profile capability ${name}`);
}

assert(generated.includes(`RPC_CONTRACT = ${JSON.stringify(legacyContract)}`),
  `generated contract does not match ${legacyContract}`);
assert(generated.includes(`RPC_JSON_VERSION = ${JSON.stringify(legacyJsonrpcVersion)}`),
  `generated JSON-RPC version does not match ${legacyJsonrpcVersion}`);
assertSameStringSet(extractStringArray(generated, "RPC_METHODS"), legacy.methods,
  "generated legacy RPC methods");
assertSameStringMap(extractStringMap(generated, "RPC_CAPABILITIES"), legacyCapabilities,
  "generated legacy RPC capabilities");

const officialDiscoveryMethod = official.discovery.method;
const officialRequiredMethods = official.methods.filter((method) => method !== officialDiscoveryMethod);
const officialSource = requireObject(official.profile.source, "official profile source");
assert(officialSource.release === "v1.4.3", "official profile must declare the v1.4.3 baseline release");
requireAuditRef(officialSource.audited_main, "official profile source.audited_main");
const officialAgent = requireObject(official.profile.agent, "official profile agent");
requireString(officialAgent.repository, "official profile agent.repository");
assert(officialAgent.release === "v1.2.60", "official profile must declare the v1.2.60 agent baseline release");
requireAuditRef(officialAgent.audited_main, "official profile agent.audited_main");
assert(official.discovery.params.internal === true,
  "official profile must discover internal methods with internal: true");
assert(official.discovery.response.type === "string[]",
  "official profile must declare rpc.methods' string-array response");
assert(backendProfileSource.includes(`call(${JSON.stringify(officialDiscoveryMethod)}, { internal: true })`),
  `backend profile must discover official methods with ${officialDiscoveryMethod}`);
assertSameStringSet(extractStringArray(backendProfileSource, "OFFICIAL_REQUIRED_METHODS"), officialRequiredMethods,
  "official required RPC methods declared by backendProfile");

console.log(`verified ${expectedProfiles.length} local backend profiles: ${legacy.profile.kind}, ${official.profile.kind}`);
