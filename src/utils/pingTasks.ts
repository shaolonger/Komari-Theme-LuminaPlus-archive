export type HomepagePingTaskBindings = Record<string, string[]>;
export type HomepagePingTaskOrder = Record<string, number[]>;

export function normalizeHomepagePingTaskOrder(value: unknown, bindings: HomepagePingTaskBindings): HomepagePingTaskOrder {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries([...getHomepagePingTaskIdsByClient(bindings)].map(([uuid, ids]) => {
    const configured = Array.isArray(source[uuid]) ? source[uuid].map(Number) : [];
    return [uuid, [...new Set([...configured.filter((id) => ids.includes(id)), ...ids])]];
  }));
}

export function normalizeHomepagePingTaskBindings(
  value: unknown,
): HomepagePingTaskBindings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const normalized: HomepagePingTaskBindings = {};
  for (const [taskId, clients] of Object.entries(value)) {
    const numericTaskId = Number(taskId);
    if (!Number.isInteger(numericTaskId) || numericTaskId <= 0) {
      continue;
    }

    if (!Array.isArray(clients)) {
      continue;
    }

    const uniqueClients = Array.from(
      new Set(
        clients
          .map((client) => (typeof client === "string" ? client.trim() : ""))
          .filter(Boolean),
      ),
    );
    if (uniqueClients.length === 0) {
      continue;
    }

    normalized[String(numericTaskId)] = uniqueClients;
  }

  return normalized;
}

/**
 * Keeps only homepage bindings whose Ping task is present in a freshly loaded
 * task catalogue. This deliberately leaves validation to the caller: public
 * pages may not have permission to read the catalogue, while the theme admin
 * page does and can turn the result into a clean saved configuration.
 */
export function filterHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
  availableTaskIds: Iterable<number>,
): HomepagePingTaskBindings {
  const available = new Set(
    Array.from(availableTaskIds).filter(
      (taskId) => Number.isInteger(taskId) && taskId > 0,
    ),
  );
  const filtered: HomepagePingTaskBindings = {};

  for (const [taskId, clients] of Object.entries(normalizeHomepagePingTaskBindings(bindings))) {
    if (available.has(Number(taskId))) {
      filtered[taskId] = clients;
    }
  }

  return filtered;
}

export function invertHomepagePingTaskBindings(
  bindings: HomepagePingTaskBindings,
): Map<string, number> {
  const selectedTaskByClient = new Map<string, number>();
  const entries = Object.entries(bindings).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = Number(taskId);
    if (!Number.isInteger(numericTaskId) || numericTaskId <= 0) {
      continue;
    }
    for (const client of clients) {
      if (!selectedTaskByClient.has(client)) {
        selectedTaskByClient.set(client, numericTaskId);
      }
    }
  }

  return selectedTaskByClient;
}

export function getHomepagePingTaskIdsByClient(
  bindings: HomepagePingTaskBindings,
): Map<string, number[]> {
  const taskIdsByClient = new Map<string, number[]>();
  const entries = Object.entries(normalizeHomepagePingTaskBindings(bindings)).sort(
    ([left], [right]) => Number(left) - Number(right),
  );

  for (const [taskId, clients] of entries) {
    const numericTaskId = Number(taskId);
    if (!Number.isInteger(numericTaskId) || numericTaskId <= 0) {
      continue;
    }
    for (const client of clients) {
      const current = taskIdsByClient.get(client) ?? [];
      if (!current.includes(numericTaskId)) {
        current.push(numericTaskId);
        taskIdsByClient.set(client, current);
      }
    }
  }

  return taskIdsByClient;
}

export function countHomepagePingBindingPairs(bindings: HomepagePingTaskBindings) {
  return Object.values(normalizeHomepagePingTaskBindings(bindings)).reduce(
    (total, clients) => total + clients.length,
    0,
  );
}

export function countHomepagePingBoundClients(bindings: HomepagePingTaskBindings) {
  return getHomepagePingTaskIdsByClient(bindings).size;
}
