# Aster VPS home density TODO

Scope note: this round optimizes the home-page VPS scanning experience with an Apple-inspired, content-first visual hierarchy. Remote terminal, remote command execution, GPU controls, and automatic update controls remain out of scope.

- [x] Replace the expanded default VPS management workbench with a compact Liquid Glass style fleet status bar and an explicit expand/collapse details panel.
- [x] Merge the separate operations queue into the workbench details so daily insights occupy one coherent, collapsible surface.
- [x] Use authenticated admin client metadata as an overlay for agent version data, while keeping public-mode privacy behavior intact.
- [x] Adjust configuration completeness so admin-only/private fields do not create false "missing Agent version" warnings for public metadata.
- [x] Make the desktop default VPS card view more compact and improve the compact card for fast scanning.
- [x] Add tests for admin metadata merging, privacy-aware completeness, and workbench summary behavior.
- [x] Run full checks, update the theme version, tag, push, and publish a GitHub release.
