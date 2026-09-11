# Aster 3D Fleet Atlas TODO

Scope note: build an additional 3D fleet view mode for VPS operations. Existing card/list and comparison workflows remain the primary daily interfaces. Remote terminal, remote command execution, GPU controls, and automatic update controls remain out of scope.

Context recovery note: if an LLM context compaction happens, continue from this file. Inspect `git log --oneline -10`, run `git status --short`, and resume from the first unchecked Phase 1 item. Commit after each completed Phase 1 task.

## Phase 1 - Stable 3D Fleet Star Map

- [x] Add the Three.js runtime dependency and deterministic 3D fleet data model utilities for node placement, color, scale, group orbit metadata, and compare deep links. Verify with targeted unit tests plus `npm run typecheck`.
- [x] Build a full-bleed Three.js star-map renderer with animated starfield, group orbits, glowing VPS nodes, click selection, and drag marquee selection for compare. Verify with `npm run typecheck`.
- [x] Add the `/fleet-3d` route and operational overlays: fleet status strip, filters, selected-node inspector, and compare tray linking to `/compare?nodes=...`. Verify with `npm run build`.
- [x] Add homepage 3D entry points for normal and empty states so users can switch from daily scanning into the 3D view. Verify with `npm run lint` and browser smoke test.
- [x] Run desktop and mobile browser checks for the 3D canvas: nonblank pixels, visible animation between frames, no console errors, and usable overlay layout.
- [x] Run full checks, update the theme version, tag, push, and publish a GitHub release.

## Phase 2 - Signal-Rich Immersion

- [x] Add real-time traffic particles for upload/download direction and density.
- [x] Add Ping quality halos: latency radius, loss fragmentation, and warning pulses.
- [x] Add risk scan mode that dims healthy VPS and emphasizes expiry, traffic pressure, offline, and data-completeness issues.
- [x] Add timeline replay for 1h/4h/1d ranges using existing history APIs, with synchronized node color/scale transitions.
- [x] Add group/region focus transitions and camera presets for large fleets.
- [x] Add visual performance controls for low-power devices.

## Phase 3 - Advanced Presentation And WebGPU Enhancement

- [x] Add optional WebGPU renderer capability detection with WebGL2 fallback.
- [x] Add NOC auto-cruise mode that rotates through groups and highlights attention nodes.
- [x] Add share/export snapshot support for a 3D fleet state image.
- [x] Add guided anomaly storytelling that sequences through the top issues in the scene.
- [x] Add optional globe mode when reliable region/country coordinates are available.
- [x] Add deeper browser and visual regression checks for WebGPU/WebGL fallback behavior.
