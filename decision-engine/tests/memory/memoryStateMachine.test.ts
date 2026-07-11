import { describe, it, expect } from "vitest";
import { MemoryState } from "../../src/types";
import { assertValidMemoryTransition, isValidMemoryTransition } from "../../src/memory/MemoryStateMachine";
import { InvalidMemoryTransitionError } from "../../src/memory/errors";

const ALL_STATES: MemoryState[] = ["Missing", "Learning", "Knows"];

describe("MemoryStateMachine", () => {
  it("allows the documented forward promotion path", () => {
    expect(isValidMemoryTransition("Missing", "Learning")).toBe(true);
    expect(isValidMemoryTransition("Learning", "Knows")).toBe(true);
  });

  it("rejects skipping Missing straight to Knows", () => {
    expect(isValidMemoryTransition("Missing", "Knows")).toBe(false);
  });

  it("allows the documented regression path", () => {
    expect(isValidMemoryTransition("Knows", "Learning")).toBe(true);
    expect(isValidMemoryTransition("Learning", "Missing")).toBe(true);
  });

  it("rejects Knows straight to Missing without forceCollapse", () => {
    expect(isValidMemoryTransition("Knows", "Missing")).toBe(false);
  });

  it("allows Knows straight to Missing with forceCollapse", () => {
    expect(isValidMemoryTransition("Knows", "Missing", { forceCollapse: true })).toBe(true);
  });

  it("forceCollapse does not open any other invalid transition", () => {
    expect(isValidMemoryTransition("Missing", "Knows", { forceCollapse: true })).toBe(false);
  });

  it("rejects Missing straight to Knows without userCorrection", () => {
    expect(isValidMemoryTransition("Missing", "Knows")).toBe(false);
  });

  it("allows any state straight to Knows with userCorrection", () => {
    expect(isValidMemoryTransition("Missing", "Knows", { userCorrection: true })).toBe(true);
    expect(isValidMemoryTransition("Learning", "Knows", { userCorrection: true })).toBe(true);
  });

  it("userCorrection does not open a transition to any state other than Knows", () => {
    expect(isValidMemoryTransition("Knows", "Missing", { userCorrection: true })).toBe(false);
  });

  it("allows every same-state reinforcement", () => {
    for (const state of ALL_STATES) {
      expect(isValidMemoryTransition(state, state)).toBe(true);
    }
  });

  it("assertValidMemoryTransition throws InvalidMemoryTransitionError for a rejected transition", () => {
    expect(() => assertValidMemoryTransition("Missing", "Knows")).toThrow(InvalidMemoryTransitionError);
  });

  it("assertValidMemoryTransition does not throw for an allowed transition", () => {
    expect(() => assertValidMemoryTransition("Missing", "Learning")).not.toThrow();
  });

  it("every from/to combination not documented above is rejected", () => {
    const allowed = new Set([
      "Missing->Missing",
      "Missing->Learning",
      "Learning->Learning",
      "Learning->Knows",
      "Learning->Missing",
      "Knows->Knows",
      "Knows->Learning",
    ]);
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        const key = `${from}->${to}`;
        expect(isValidMemoryTransition(from, to)).toBe(allowed.has(key));
      }
    }
  });
});
