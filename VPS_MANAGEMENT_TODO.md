# Aster VPS management upgrade TODO

Scope note: GPU monitoring, remote terminal, remote command execution, and automatic update controls are intentionally out of scope for this round.

- [x] Extend node/admin client models for safe agent metadata: version, public IPs, Ping capability, and private-target Ping capability.
- [x] Add a homepage operations queue with practical VPS risks: offline/stale reporting, upcoming expiry, traffic quota pressure, and Ping binding misconfiguration.
- [x] Let homepage risk chips filter the node grid so urgent VPS can be inspected without manual scanning.
- [x] Enhance the instance detail page with operations-oriented sections for agent identity, Ping capability, traffic quota, expiry, and cost metadata.
- [x] Add Ping diagnostics to theme management so bound nodes with disabled or potentially restricted Ping capability are visible before saving.
- [x] Cover the new risk and metadata logic with focused tests.
- [x] Run the project checks, update the theme version, tag, push, and publish a GitHub release.
