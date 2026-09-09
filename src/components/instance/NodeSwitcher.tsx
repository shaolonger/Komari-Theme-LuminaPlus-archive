import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { NodeInfo } from "@/types/komari";

export function NodeSwitcher({ nodes, currentUuid, onSelect }: { nodes: NodeInfo[]; currentUuid: string; onSelect: (uuid: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const current = nodes.find((node) => node.uuid === currentUuid);
  const matches = useMemo(() => {
    const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return nodes.filter((node) => words.every((word) => `${node.name} ${node.uuid} ${node.group ?? ""} ${node.region ?? ""}`.toLocaleLowerCase().includes(word)));
  }, [nodes, query]);
  const index = Math.min(active, Math.max(0, matches.length - 1));
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, listId, open]);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const choose = (uuid: string) => { setOpen(false); setQuery(""); setActive(0); onSelect(uuid); };
  return <div ref={root} className="instance-node-switcher node-search-switcher" onBlur={() => {
    // Browsers may report a null relatedTarget while restoring focus during
    // layout. Close only after focus has actually left the component.
    requestAnimationFrame(() => { if (!root.current?.contains(document.activeElement)) setOpen(false); });
  }}>
    <label className="instance-node-switcher-label" htmlFor={`${listId}-input`}>切换 VPS</label>
    <input id={`${listId}-input`} className="instance-node-select" role="combobox" autoComplete="off"
      aria-label="搜索并切换 VPS" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && matches.length ? `${listId}-${index}` : undefined}
      value={open ? query : current?.name ?? ""} placeholder="输入名称、分组或 UUID 搜索"
      onFocus={() => { setOpen(true); setQuery(""); setActive(0); }}
      onClick={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { setOpen(false); return; }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          setActive(Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        }
        if (event.key === "Enter" && open) { event.preventDefault(); if (matches[index]) choose(matches[index].uuid); }
      }} />
    {open && <div className="node-switch-results" id={listId} role="listbox" aria-label="匹配的 VPS">
      {matches.map((node, position) => <div id={`${listId}-${position}`} key={node.uuid} role="option" aria-selected={position === index}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(node.uuid)}>
        <strong>{node.name || node.uuid}{node.uuid === currentUuid ? " · 当前" : ""}</strong>
        <small>{[node.group, node.region, node.uuid].filter(Boolean).join(" · ")}</small>
      </div>)}
      {!matches.length && <div role="status">没有匹配的 VPS</div>}
    </div>}
  </div>;
}
