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

## Status

Implements the schemas and pure functions from the spec. Not yet wired to a real Signal Store, EventLog, or Knowledge Graph persistence layer — those are the next milestones once this is reviewed.
