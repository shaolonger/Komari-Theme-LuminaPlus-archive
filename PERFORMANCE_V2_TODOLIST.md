# Aster Performance V2 Todo

Every checked item requires focused tests, typecheck/build, affected browser
tests and a dedicated commit.

## L2-0 Baseline

- [x] **L2-001 Freeze the V2 design, tests and bundle baseline**
- [x] **L2-002 Add RPC request-count, render-time, heap and bundle gates**

## L2-1 Contract and data flow

- [x] **L2-101 Consume generated RPC types and capability discovery**
- [x] **L2-102 Replace 2-second full polling with resumable deltas**
- [x] **L2-103 Replace per-task Ping overview with one set request**
- [x] **L2-104 Replace per-node Compare history with one set request**
- [x] **L2-105 Restrict fallback to typed transport errors**

## L2-2 Rendering and assets

- [x] **L2-201 Suspend invisible card Canvas work and virtualize large fleets**
- [x] **L2-202 Move large comparison analysis to a typed-array Worker**
- [x] **L2-203 Pause/scale Fleet 3D and preserve route-only loading**
- [x] **L2-204 Meet initial JS/CSS/font/icon bundle budgets**

## L2-3 Acceptance and release

- [x] **L2-301 Contract matrix, 30/300/1000-node browser and long-run tests**
- [x] **L2-302 Version, push, tag and publish the Aster release**
