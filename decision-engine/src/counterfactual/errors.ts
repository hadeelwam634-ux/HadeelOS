/** Base class for every error this module throws. */
export class CounterfactualError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CounterfactualError";
  }
}

/**
 * Thrown only for genuine internal-consistency failures (e.g. a
 * contributor computation producing a non-finite number). Expected
 * degenerate inputs — empty candidateDecisions, missing signals, a
 * decision type with no linked Knowledge Graph edges — are NOT errors:
 * per "Final Execution Orders" PR #7 ("empty candidates تعيد نتيجة
 * واضحة، لا exception غامضة"), those are handled by returning a
 * well-formed CounterfactualResult with selectedScenario: null and an
 * explicit uncertainty.reason instead of throwing.
 */
export class CounterfactualComputationError extends CounterfactualError {
  constructor(message: string) {
    super(message);
    this.name = "CounterfactualComputationError";
  }
}
