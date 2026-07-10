# HadeelOS Decision Engine

TypeScript implementation of the [Decision Engine Specification v1](https://app.notion.com/p/399fe46cdbd081f0becee103be74f8bf) — the schemas, confidence calculator, decision lifecycle state machine, and `recalc()` function that power HadeelOS's Today Cockpit.

## Contents

- `src/types.ts` — Signal, SignalStore, EventLog, Decision, KGNode/KGEdge (Observation/Hypothesis/Belief/Decision record types), Hypothesis, Experiment, DigitalTwin, JournalEntry, MemoryGovernanceLog
- `src/confidence.ts` — `calculateConfidence()` implementing `Confidence = w1·SignalReliability + w2·HistoricalAccuracy + w3·CausalMaturityScore`
- `src/decisionStateMachine.ts` — the Decision state machine (`Proposed → Presented → Accepted/Rejected/Ignored → OutcomeRecorded`, with `Revised` looping back to `Presented`)
- `src/recalc.ts` — the formal `recalc()`, replacing the flat "+1% per accepted item" heuristic in the `today_cockpit` HTML prototypes with real confidence-weighted forecast and timeline ordering
- `tests/` — unit tests (vitest) for all of the above

## Usage

```bash
npm install
npm run typecheck
npm test
```

## Persistence layer (PR #2)

- `src/persistence/SignalStoreRepository.ts` / `EventLogRepository.ts` — storage-agnostic interfaces. Every method returns a `Promise`, and `EventLogRepository` has no update or delete method at all, so the append-only guarantee is enforced by the type signature, not just convention.
- `src/persistence/InMemorySignalStoreRepository.ts` / `InMemoryEventLogRepository.ts` — the initial backend. A future `PostgresSignalStoreRepository` / `PostgresEventLogRepository` implements the same interfaces; no call site elsewhere in the codebase needs to change.
- `src/persistence/clone.ts` — every entry is deep-cloned (`structuredClone`) at both the write boundary (`append`/`upsert`) and the read boundary (`getAll`/`get`/`findByDecisionId`). Without this, callers could mutate an object they passed in or got back and silently rewrite "immutable" history — the append-only guarantee has to hold for real, not just be the absence of an `update()` method.
- `append()` on `EventLogRepository` throws `DuplicateEventLogEntryError` for a repeated `id`, mirroring the primary-key constraint any real database-backed implementation will also enforce.
- `tests/persistence/*.contract.ts` — a reusable behavioral test suite per interface (`runSignalStoreRepositoryContractTests`, `runEventLogRepositoryContractTests`), including mutation-after-write and mutation-after-read cases and the duplicate-id case. Any new implementation's test file just imports the contract and calls it with its own factory — if it passes, the implementation is a verified drop-in replacement.
- Recording an outcome after the fact means **appending** a new `EventLogEntry` for the same `decisionId`, not mutating the original — `findByDecisionId` reconstructs the full history in insertion order. This mirrors the immutable-history guarantee already enforced by the Decision state machine (`OutcomeRecorded` is terminal, `supersedesDecisionId` links a new decision back to an old one).

## Status

Implements the schemas, pure functions, and in-memory persistence layer from the spec. Not yet wired to a real database (Postgres) or to the Knowledge Graph / Experiment lifecycle / Memory Governance enforcement — those are the next milestones.

## Design notes from review

- `recalc()` takes both `currentSignalStore` (the full known state) and `signalStoreDelta` (what changed since the last pass), and merges them before computing confidence. Using the delta alone would zero out confidence during a quiet period with no fresh signals, even though the system's last-known state is still valid.
- `SignalType` is `KnownSignalType | \`custom:${string}\`` rather than `KnownSignalType | string` — the latter silently widens the whole union to `string` and defeats type-checking.
- `OutcomeRecorded` is a terminal state. A decision whose outcome has been logged is closed history and is never rewritten. If new signals change the recommendation afterward, a new `Decision` is created with `supersedesDecisionId` pointing back to the original, instead of transitioning it to `Revised`.
- CI (`.github/workflows/decision-engine-ci.yml`) runs `npm ci`, `npm run typecheck`, and `npm test` on every PR touching this package.
