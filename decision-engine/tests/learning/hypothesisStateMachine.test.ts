import { describe, it, expect } from "vitest";
import { HypothesisStatus } from "../../src/types";
import {
  assertValidHypothesisTransition,
  isTerminalHypothesisStatus,
  isValidHypothesisTransition,
} from "../../src/learning/HypothesisStateMachine";
import { InvalidHypothesisTransitionError } from "../../src/learning/errors";

const ALL_STATUSES: HypothesisStatus[] = [
  "forming",
  "testing",
  "confirmed",
  "rejected",
  "unknown_competing",
];

const VALID_TRANSITIONS: Array<[HypothesisStatus, HypothesisStatus]> = [
  ["forming", "testing"],
  ["forming", "unknown_competing"],
  ["testing", "confirmed"],
  ["testing", "rejected"],
];

describe("HypothesisStateMachine", () => {
  it("allows exactly the three documented lifecycle paths", () => {
    for (const [from, to] of VALID_TRANSITIONS) {
      expect(isValidHypothesisTransition(from, to)).toBe(true);
      expect(() => assertValidHypothesisTransition(from, to)).not.toThrow();
    }
  });

  it("rejects every other from/to combination", () => {
    const validSet = new Set(VALID_TRANSITIONS.map(([f, t]) => `${f}->${t}`));
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (validSet.has(`${from}->${to}`)) continue;
        expect(isValidHypothesisTransition(from, to)).toBe(false);
        expect(() => assertValidHypothesisTransition(from, to)).toThrow(
          InvalidHypothesisTransitionError
        );
      }
    }
  });

  it("treats confirmed, rejected, and unknown_competing as terminal", () => {
    expect(isTerminalHypothesisStatus("confirmed")).toBe(true);
    expect(isTerminalHypothesisStatus("rejected")).toBe(true);
    expect(isTerminalHypothesisStatus("unknown_competing")).toBe(true);
    expect(isTerminalHypothesisStatus("forming")).toBe(false);
    expect(isTerminalHypothesisStatus("testing")).toBe(false);
  });
});
