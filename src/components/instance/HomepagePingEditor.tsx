import { useState } from "react";
import type { AdminClient, PingTask } from "@/types/komari";
import { normalizeHomepagePingTaskOrder, type HomepagePingTaskBindings, type HomepagePingTaskOrder } from "@/utils/pingTasks";

export function HomepagePingEditor({ clients, tasks, bindings, order, onChange }: {
  clients: AdminClient[];
  tasks: PingTask[];
  bindings: HomepagePingTaskBindings;
  order: HomepagePingTaskOrder;
  onChange: (bindings: HomepagePingTaskBindings, order: HomepagePingTaskOrder) => void;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [batchTasks, setBatchTasks] = useState<number[]>([]);
  const resolved = normalizeHomepagePingTaskOrder(order, bindings);
  const visible = clients.filter((client) => `${client.name} ${client.uuid} ${client.group} ${client.region}`.toLowerCase().includes(search.toLowerCase()));
  const taskNames = new Map(tasks.map((task) => [task.id, task.name || `任务 #${task.id}`]));
  function assign(uuids: string[], ids: number[], append = false) {
    const next = Object.fromEntries(Object.entries(bindings).map(([id, nodes]) => [id, [...nodes]]));
    const nextOrder = { ...resolved };
    for (const uuid of uuids) {
      const sequence = [...new Set(append ? [...(resolved[uuid] ?? []), ...ids] : ids)];
      for (const key of Object.keys(next)) next[key] = next[key].filter((node) => node !== uuid);
      for (const id of sequence) next[id] = [...(next[id] ?? []), uuid];
      nextOrder[uuid] = sequence;
    }
    onChange(next, nextOrder);
  }
  function picker(ids: number[], update: (ids: number[]) => void) {
    return <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">{tasks.map((task) => <label key={task.id} className="surface-inset flex items-center gap-2 px-3 py-2 text-xs">
        <input type="checkbox" checked={ids.includes(task.id)} onChange={(event) => update(event.target.checked ? [...ids, task.id] : ids.filter((id) => id !== task.id))} />
        {taskNames.get(task.id)} <span className="text-[var(--text-tertiary)]">#{task.id}</span>
      </label>)}</div>
      <ol className="flex flex-wrap gap-2">{ids.map((id, index) => <li key={id} className="surface-inset flex items-center gap-2 px-2 py-1 text-xs">
        <span>{index + 1}. {taskNames.get(id) ?? `任务 #${id}`}</span>
        <button type="button" disabled={index === 0} aria-label={`上移 ${taskNames.get(id)}`} onClick={() => {
          const next = [...ids]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; update(next);
        }}>↑</button>
        <button type="button" disabled={index === ids.length - 1} aria-label={`下移 ${taskNames.get(id)}`} onClick={() => {
          const next = [...ids]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; update(next);
        }}>↓</button>
      </li>)}</ol>
    </div>;
  }
  return <div className="flex flex-col gap-3">
    <input className="surface-inset p-3 text-sm" aria-label="搜索要配置的 VPS" placeholder="搜索 VPS 名称 / UUID / 分组 / 地区" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="flex flex-wrap items-center gap-3 text-xs">
      <button type="button" className="theme-manage-button is-compact" onClick={() => setSelected([...new Set([...selected, ...visible.map((client) => client.uuid)])])}>选择当前结果</button>
      <button type="button" className="theme-manage-button is-compact" onClick={() => setSelected([])}>取消选择</button>
      <span>已选 {selected.length} 台 · 共 {clients.length} 台 VPS</span>
    </div>
    {selected.length > 0 && <div className="surface-inset flex flex-col gap-3 p-3">
      <strong className="text-sm">批量配置 {selected.length} 台 VPS</strong>
      <p className="text-xs text-[var(--text-tertiary)]">勾选任务后可调整顺序；替换会覆盖所选 VPS 的现有展示配置，追加会保留原有顺序。</p>
      {picker(batchTasks, setBatchTasks)}
      <div className="flex gap-2">
        <button type="button" className="theme-manage-button is-compact" onClick={() => assign(selected, batchTasks)}>替换所选 VPS 的任务</button>
        <button type="button" className="theme-manage-button is-compact" disabled={!batchTasks.length} onClick={() => assign(selected, batchTasks, true)}>追加任务</button>
      </div>
    </div>}
    {visible.map((client) => <section key={client.uuid} className="surface-inset p-3">
      <div className="flex items-center gap-3">
        <input type="checkbox" aria-label={`选择 ${client.name}`} checked={selected.includes(client.uuid)} onChange={(event) => setSelected(event.target.checked ? [...selected, client.uuid] : selected.filter((uuid) => uuid !== client.uuid))} />
        <div className="min-w-0 flex-1"><strong className="block truncate text-sm">{client.name || client.uuid}</strong><span className="text-xs text-[var(--text-tertiary)]">{client.group || client.region} · {(resolved[client.uuid] ?? []).length} 个任务</span></div>
        <button type="button" className="theme-manage-button is-compact" aria-expanded={editing === client.uuid} onClick={() => setEditing(editing === client.uuid ? null : client.uuid)}>{editing === client.uuid ? "收起" : "配置任务"}</button>
      </div>
      {editing === client.uuid ? <div className="mt-3">{picker(resolved[client.uuid] ?? [], (ids) => assign([client.uuid], ids))}</div> : <p className="mt-2 text-xs text-[var(--text-secondary)]">{(resolved[client.uuid] ?? []).map((id) => taskNames.get(id) ?? `任务 #${id}`).join(" → ") || "未配置：卡片不显示延迟任务"}</p>}
    </section>)}
    {!visible.length && <p className="p-3 text-sm">没有匹配的 VPS。</p>}
  </div>;
}
