import { describe, it, expect } from "vitest";
import { ExperimentStatus } from "../../src/types";
import {
  assertValidExperimentTransition,
  isFinalExperimentStatus,
  isValidExperimentTransition,
} from "../../src/learning/ExperimentStateMachine";
import { InvalidExperimentTransitionError } from "../../src/learning/errors";

const ALL_STATUSES: ExperimentStatus[] = [
  "proposed",
  "awaiting_consent",
  "baseline",
  "running",
  "washout",
  "evaluated",
  "confirmed",
  "rejected",
  "aborted",
  "inconclusive",
];

const NON_FINAL: ExperimentStatus[] = [
  "proposed",
  "awaiting_consent",
  "baseline",
  "running",
  "washout",
  "evaluated",
];

const FORWARD_TRANSITIONS: Array<[ExperimentStatus, ExperimentStatus]> = [
  ["proposed", "awaiting_consent"],
  ["proposed", "baseline"],
  ["awaiting_consent", "baseline"],
  ["baseline", "running"],
  ["running", "washout"],
  ["washout", "evaluated"],
  ["evaluated", "confirmed"],
  ["evaluated", "rejected"],
  ["evaluated", "inconclusive"],
];

describe("ExperimentStateMachine", () => {
  it("allows every documented forward transition", () => {
    for (const [from, to] of FORWARD_TRANSITIONS) {
      expect(isValidExperimentTransition(from, to)).toBe(true);
      expect(() => assertValidExperimentTransition(from, to)).not.toThrow();
    }
  });

  it("allows aborting from any non-final status", () => {
    for (const from of NON_FINAL) {
      expect(isValidExperimentTransition(from, "aborted")).toBe(true);
    }
  });

  it("rejects skipping states", () => {
    expect(isValidExperimentTransition("proposed", "running")).toBe(false);
    expect(isValidExperimentTransition("baseline", "washout")).toBe(false);
    expect(isValidExperimentTransition("awaiting_consent", "running")).toBe(false);
    expect(() => assertValidExperimentTransition("proposed", "evaluated")).toThrow(
      InvalidExperimentTransitionError
    );
  });

  it("rejects any transition out of a final status, including to aborted", () => {
    for (const from of ["confirmed", "rejected", "inconclusive", "aborted"] as ExperimentStatus[]) {
      for (const to of ALL_STATUSES) {
        if (from === to) continue;
        expect(isValidExperimentTransition(from, to)).toBe(false);
      }
    }
  });

  it("marks confirmed/rejected/inconclusive/aborted as final, everything else as non-final", () => {
    expect(isFinalExperimentStatus("confirmed")).toBe(true);
    expect(isFinalExperimentStatus("rejected")).toBe(true);
    expect(isFinalExperimentStatus("inconclusive")).toBe(true);
    expect(isFinalExperimentStatus("aborted")).toBe(true);
    for (const status of NON_FINAL) {
      expect(isFinalExperimentStatus(status)).toBe(false);
    }
  });
});
