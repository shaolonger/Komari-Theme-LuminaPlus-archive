# Aster VPS comparison TODO

Scope note: build the first-stage VPS comparison workspace only. Remote terminal, remote command execution, GPU controls, and automatic update controls remain out of scope.

Context recovery note: this file is the source of truth if an LLM context compaction happens mid-implementation. Continue from the first unchecked item, inspect `git log --oneline -8`, and verify with the command listed on each item before committing.

- [x] Add typed comparison data access for multi-node load and ping history, including light `load_type` RPC requests and range-aware record limits. Verify with `npm run typecheck` and targeted unit tests.
- [x] Add comparison data utilities for metric extraction, aligned time-series generation, summary statistics, ranking rows, and Markdown/CSV export. Verify with targeted unit tests.
- [x] Build the `/compare` workspace with VPS multi-select, metric picker, time range picker, trend/ranking tabs, synchronized uPlot tooltip, and export actions. Verify with `npm run typecheck`.
- [x] Add Apple-inspired comparison workspace styling and responsive behavior, keeping dense operational surfaces and avoiding marketing-style layout. Verify with `npm run build`.
- [x] Add a homepage entry point and selected-node deep-link support so users can start comparison from daily scanning. Verify with local browser smoke test.
- [x] Run full checks, update the theme version, tag, push, and publish a GitHub release.
