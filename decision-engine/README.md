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

## Application service (PR #3)

- `src/application/DecisionApplicationService.ts` — the **only** entry point that is allowed to call `SignalStoreRepository`, `EventLogRepository`, or `recalc()`. Nothing else in the codebase (and, later, the API layer) should reach past this class into the repositories or domain functions directly.
- `recalculateDay()` always runs in this fixed order: read the current signal store → upsert the incoming signal delta → read the effective signal store back from the repository → call `recalc()` **against that persisted effective store** → append one `EventLogEntry` per accepted decision. `recalc()` is deliberately called with `currentSignalStore: effectiveSignalStore` and an empty delta, never with the raw pre-persistence values — a real (e.g. Postgres) repository may normalize, clamp, round, or otherwise transform values on write, so recalc() and the Event Log snapshot must reflect what was actually saved, not what was asked to be saved. Nothing is written to the Event Log until `recalc()` has succeeded.
- `src/application/types.ts` — `RecalculateDayCommand` / `RecalculateDayResult` (the only shapes a future API/UI layer needs to know about), plus the injectable `IdGenerator` and `Clock` dependencies (with `RandomIdGenerator` / `SystemClock` as the real-usage defaults) that keep event IDs and timestamps out of the service's own hands so tests can be fully deterministic.
- `src/application/errors.ts` — `ApplicationError` and its subclasses (`SignalPersistenceError`, `EventLogPersistenceError`, `RecalcExecutionError`) so callers outside this package only ever need to handle one error hierarchy, never repository- or recalc()-specific failures directly.
- The service never returns repository internals: signal stores, forecasts, and ID lists returned from `recalculateDay()` are freshly built values, so mutating a result never mutates stored state.
- **Not atomic (v1):** the per-decision `EventLogEntry` appends happen in a loop, one repository call per decision. If an append fails partway through, the entries already appended remain persisted — there is no rollback. Callers must not assume `recalculateDay()` is all-or-nothing. True atomicity needs a real transaction boundary and is deferred to the PostgreSQL adapter PR.

## Knowledge Graph (PR #4)

- `src/knowledge-graph/KnowledgeGraphRepository.ts` — storage-agnostic contract for `KGNode`/`KGEdge`: `addNode`, `getNode`, `getNodesByDomain`, `addEdge`, `getEdge`, `findEdgesFrom`, `findEdgesTo`, `findEdgesBetween`, `updateEdgeMaturity`, `getMaturityHistory`. Node and edge IDs must be unique; an edge cannot reference a `fromNodeId`/`toNodeId` that was never added via `addNode()`; `confidence` must be a finite number in `[0, 1]`; `evidenceCount` must be a safe (non-fractional) integer `>= 0`; a self-edge (`fromNodeId === toNodeId`) is rejected unless the caller explicitly passes `{ allowSelfEdge: true }`.
- `src/knowledge-graph/InMemoryKnowledgeGraphRepository.ts` — the initial backend, deep-cloning (via `../persistence/clone`) at every read and write boundary, exactly like the Signal Store / Event Log repositories from PR #2. IDs and timestamps are never generated inside the repository — callers supply fully-formed values (see `KnowledgeGraphService` below), including a fully-formed `transition` object (`recordId` + `timestamp` + optional `reason`/`overrideMaturityTransition`) for `updateEdgeMaturity()`, so repository behavior stays deterministic and testable without faking the system clock or ID generation.
- **Numeric validation** rejects `NaN` and `+/-Infinity` outright (`confidence < 0 || confidence > 1` alone would silently admit `NaN`, since every comparison against `NaN` is `false`): `assertValidConfidence` requires `Number.isFinite(value)`, and `assertValidEvidenceCount` requires `Number.isSafeInteger(value)` so fractional evidence counts are rejected too. Applied identically in `addEdge()` and `updateEdgeMaturity()`.
- `src/knowledge-graph/CausalMaturityPolicy.ts` — the only place causal maturity transition legality is decided (`correlated → suspected_causal → experimentally_supported → stable_causal`). A single natural step forward is always allowed. Skipping more than one step requires `overrideMaturityTransition: true` **and** a `reason`. Any downgrade (moving to a lower maturity) requires a `reason` — there is no silent downgrade path.
- **Maturity transition history:** every successful `updateEdgeMaturity()` call — including a same-state ("no_change") reinforcement — appends one `MaturityTransitionRecord` (`id`, `edgeId`, `from`, `to`, `kind`, `previousConfidence`/`nextConfidence`, `previousEvidenceCount`/`nextEvidenceCount`, `reason`, `overrideUsed`, `timestamp`) to an append-only, per-edge, deep-cloned history, mirroring the `EventLogRepository` pattern from PR #2: no update or delete method exists for these records. A failed validation (invalid confidence/evidenceCount, or a disallowed maturity transition) writes nothing — neither the edge nor the history changes. `getMaturityHistory(edgeId)` returns the full trail in insertion order (an empty array for an edge with no history yet, or for an unknown edge id — it never throws). Previously, transition legality was validated but the outcome was never persisted anywhere, so there was no way to audit *why* an edge's maturity had changed; this closes that gap.
- `src/knowledge-graph/KnowledgeGraphService.ts` — thin orchestration layer with injected `IdGenerator`/`Clock` (reusing the same interfaces from `src/application/types.ts`), so it's the only place that constructs `KGNode`/`KGEdge` IDs and timestamps, including the `recordId` for each maturity-transition record. Nothing outside this service should call `KnowledgeGraphRepository` directly. `getMaturityHistory()` is exposed as a thin passthrough so callers never need to reach past the service to read the audit trail.
- `tests/knowledge-graph/knowledgeGraphRepository.contract.ts` — reusable behavioral test suite (`runKnowledgeGraphRepositoryContractTests`), covering duplicate IDs, missing node references, invalid confidence/evidence (including `NaN`/`Infinity`/`-Infinity`/fractional evidenceCount), the self-edge rule, every maturity-transition case (natural step, rejected skip, allowed override-with-reason, rejected silent downgrade, allowed downgrade-with-reason), the full maturity-history audit trail (reason persisted on downgrade, `overrideUsed: true` on override, `reason: null` on a natural advance, a same-state reinforcement recording an event, stable insertion order across multiple updates, mutation-safety of returned records, and "failed validation writes nothing"), defensive cloning, and insertion/query order. Any future `PostgresKnowledgeGraphRepository` test file just imports and calls this contract with its own factory.

## Status

Implements the schemas, pure functions, in-memory persistence layer, the Application Service, and the Knowledge Graph persistence layer from the spec. Not yet wired to a real database (Postgres) or to the Hypothesis/Experiment lifecycle or Memory Governance enforcement — those are the next milestones.

## Design notes from review

- `recalc()` takes both `currentSignalStore` (the full known state) and `signalStoreDelta` (what changed since the last pass), and merges them before computing confidence. Using the delta alone would zero out confidence during a quiet period with no fresh signals, even though the system's last-known state is still valid.
- `SignalType` is `KnownSignalType | \`custom:${string}\`` rather than `KnownSignalType | string` — the latter silently widens the whole union to `string` and defeats type-checking.
- `OutcomeRecorded` is a terminal state. A decision whose outcome has been logged is closed history and is never rewritten. If new signals change the recommendation afterward, a new `Decision` is created with `supersedesDecisionId` pointing back to the original, instead of transitioning it to `Revised`.
- CI (`.github/workflows/decision-engine-ci.yml`) runs `npm ci`, `npm run typecheck`, and `npm test` on every PR touching this package.
