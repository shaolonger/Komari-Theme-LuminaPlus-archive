# Homepage Multi-Ping TODO

Scope: first-stage upgrade for homepage Ping display and Aster theme settings. A VPS can be associated with multiple Ping tasks, homepage cards show a compact worst-first aggregate, and existing single-task settings remain compatible. Remote terminal, remote command execution, GPU controls, and automatic update controls remain out of scope.

Context recovery note: if LLM context compaction happens, resume from this file. Run `git status --short`, `git log --oneline -10`, and continue from the first unchecked task. Each task must be implemented, checked, and committed with its checkbox marked complete before moving on.

## Product Decisions

- Keep the current persisted setting shape, `homepagePingBindings: Record<taskId, nodeUuid[]>`. It already supports the same node appearing under multiple tasks and preserves compatibility with existing settings.
- Change the interpretation from "each node belongs to one task" to "each task contributes one signal to every bound node".
- Homepage cards should remain compact. They show a single aggregate latency/loss using worst-first semantics, with task count and task detail exposed through titles/tooltips.
- First-stage aggregation defaults to operational safety: highest loss wins for loss, highest current latency wins for latency, and bucket charts merge samples from all bound tasks over the same one-hour window.
- Theme settings remain task-oriented for now, but node checkboxes no longer exclude nodes already selected in another task. Copy and counters should make multi-binding explicit.

## Acceptance Criteria

- Existing single-task bindings continue to behave the same.
- A node can be checked in more than one Ping task in `/?view=theme-manage`.
- The theme settings page no longer disables or hides nodes because they are bound to another task.
- Homepage cards show a bound node as configured when it has one or multiple tasks.
- For a multi-task node, homepage latency/loss uses the worst visible task signal and merged recent buckets.
- Card titles/summaries expose how many Ping tasks contributed to the aggregate.
- Unit tests cover normalization/inversion, multi-task overview aggregation, and theme setting behavior.
- Browser smoke checks cover the theme settings copy and the homepage card behavior as far as local API availability allows.

## Tasks

- [x] Create this TODO with product decisions, acceptance criteria, and recovery instructions.
- [x] Extend Ping binding utilities and types for multi-task interpretation while preserving old single-task helper behavior.
- [x] Aggregate homepage Ping overview across all bound tasks per node, including task count metadata and merged one-hour buckets.
- [x] Update theme settings Ping binding UI so a VPS can be assigned to multiple Ping tasks, with accurate copy, counters, and no single-task exclusion.
- [x] Update homepage large/compact Ping card presentation to surface multi-task summaries without increasing card density.
- [x] Add and run targeted tests for multi-task bindings, overview aggregation, and affected diagnostics/settings behavior.
- [x] Run browser smoke verification for theme settings/homepage Ping UX and fix visual or console issues.
- [x] Update version, build package, tag, push to GitHub, and create a GitHub release with the new zip asset.

## Verification Notes

- Browser smoke on local Vite (`http://127.0.0.1:5173/`) loaded the app shell without console errors.
- Local standalone Vite cannot reach a Komari backend, so `/api/me` returns 404 and the app correctly stops on the login-state guard. Full authenticated theme-settings interaction needs a Komari-backed deployment or API fixture.
