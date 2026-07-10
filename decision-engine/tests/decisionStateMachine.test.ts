import { describe, it, expect } from "vitest";
import { canTransition, transition, InvalidTransitionError } from "../src/decisionStateMachine";
import { Decision } from "../src/types";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: "d1",
    type: "quran_timing",
    proposedAction: "Finish Quran before noon",
    confidence: 0.92,
    confidenceQualifier: "high",
    alternatives: [],
    state: "Proposed",
    createdAt: "2026-07-10T06:00:00Z",
    revisedAt: null,
    revisionReason: null,
    ...overrides,
  };
}

describe("canTransition", () => {
  it("allows the documented happy path", () => {
    expect(canTransition("Proposed", "Presented")).toBe(true);
    expect(canTransition("Presented", "Accepted")).toBe(true);
    expect(canTransition("Accepted", "OutcomeRecorded")).toBe(true);
  });

  it("allows Ignored and Rejected from Presented", () => {
    expect(canTransition("Presented", "Ignored")).toBe(true);
    expect(canTransition("Presented", "Rejected")).toBe(true);
  });

  it("allows Revised from any post-Presented state, looping back to Presented", () => {
    expect(canTransition("Accepted", "Revised")).toBe(true);
    expect(canTransition("Rejected", "Revised")).toBe(true);
    expect(canTransition("OutcomeRecorded", "Revised")).toBe(true);
    expect(canTransition("Revised", "Presented")).toBe(true);
  });

  it("rejects skipping Presented", () => {
    expect(canTransition("Proposed", "Accepted")).toBe(false);
  });

  it("rejects going backwards from OutcomeRecorded to Accepted", () => {
    expect(canTransition("OutcomeRecorded", "Accepted")).toBe(false);
  });
});

describe("transition", () => {
  it("moves a decision through the happy path", () => {
    let decision = makeDecision({ state: "Proposed" });
    decision = transition(decision, "Presented");
    expect(decision.state).toBe("Presented");

    decision = transition(decision, "Accepted");
    expect(decision.state).toBe("Accepted");

    decision = transition(decision, "OutcomeRecorded");
    expect(decision.state).toBe("OutcomeRecorded");
  });

  it("throws InvalidTransitionError for an illegal jump", () => {
    const decision = makeDecision({ state: "Proposed" });
    expect(() => transition(decision, "Accepted")).toThrow(InvalidTransitionError);
  });

  it("requires a revisionReason when transitioning to Revised", () => {
    const decision = makeDecision({ state: "Accepted" });
    expect(() => transition(decision, "Revised")).toThrow(
      "A revisionReason is required when transitioning to Revised."
    );
  });

  it("stamps revisedAt and revisionReason on a valid Revised transition", () => {
    const decision = makeDecision({ state: "Accepted" });
    const revised = transition(decision, "Revised", {
      revisionReason: "New sleep signal contradicts original recommendation",
      now: () => "2026-07-10T09:00:00Z",
    });
    expect(revised.state).toBe("Revised");
    expect(revised.revisedAt).toBe("2026-07-10T09:00:00Z");
    expect(revised.revisionReason).toBe(
      "New sleep signal contradicts original recommendation"
    );
  });
});
