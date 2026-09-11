# Aster Performance V2

Status: complete; v1.22.0 release candidate

Aster keeps React, uPlot, Canvas strips and route-level lazy loading. V2
removes periodic full-state polling and per-node/task history fan-out by using
the versioned Komari RPC contract and sequence delta stream.

## Data access

- Discover server API/capabilities before enabling optional UI.
- Subscribe once to a snapshot plus sequence-numbered node deltas.
- Resume from the last sequence or request a fresh snapshot on a gap.
- Query Ping overview for all visible tasks/nodes in one budgeted request.
- Query comparison metrics for all selected nodes/metrics in one request.
- Fall back from WebSocket to HTTP only for transport failures; RPC permission,
  method, validation and schema errors are returned to the user unchanged.

## Rendering

Per-node external-store subscriptions remain the update boundary. Invisible
cards stop drawing, large lists are virtualized and analysis above the main
thread budget runs in a Worker over typed arrays. Fleet 3D remains a route-only
chunk and pauses animation while hidden or reduced motion is requested.

## Release budgets

- Home initial JavaScript Brotli: at most 160 KiB.
- Home initial CSS Brotli: at most 25 KiB.
- No non-home route is preloaded by the home entry.
- A 30-node delta is processed in at most 8 ms on the reference browser.
- Browser heap stays flat during a 30-minute accelerated live-data run.
- Home Ping uses one set request and live status uses no 2-second full poll.
