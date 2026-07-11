import { ScenarioContributor, ScenarioResult } from "./ScenarioEvaluator";

function describeContributor(c: ScenarioContributor): string {
  const pct = Math.round(c.contribution * 100);
  return `${c.source} contributed ${pct}% (confidence ${c.confidence.toFixed(2)})`;
}

/** Never mutates `scenario.contributors`. */
function topContributors(scenario: ScenarioResult, n = 2): ScenarioContributor[] {
  return [...scenario.contributors].sort((a, b) => b.contribution - a.contribution).slice(0, n);
}

function weakestContributor(scenario: ScenarioResult): ScenarioContributor | undefined {
  return [...scenario.contributors].sort((a, b) => a.contribution - b.contribution)[0];
}

export interface CounterfactualExplanation {
  selectedBecause: string[];
  rejectedBecause: Record<string, string[]>;
}

/**
 * Every explanation string is derived directly from a ScenarioResult's
 * own `contributors` — never a separately hand-written string — so the
 * explanation can never drift from the numbers that actually drove the
 * decision ("Final Execution Orders" PR #7: "التفسيرات مشتقة من
 * contributors نفسها"). Never mutates `selected` or `alternatives`.
 */
export function buildExplanation(
  selected: ScenarioResult | null,
  alternatives: readonly ScenarioResult[]
): CounterfactualExplanation {
  const selectedBecause = selected ? topContributors(selected).map(describeContributor) : [];

  const rejectedBecause: Record<string, string[]> = {};
  for (const alt of alternatives) {
    const reasons: string[] = [];
    if (selected) {
      const scoreGapPoints = Math.round((selected.score - alt.score) * 100);
      reasons.push(`scored ${scoreGapPoints} points lower than the selected scenario`);
    }
    const weakest = weakestContributor(alt);
    if (weakest) {
      reasons.push(`weakest factor: ${describeContributor(weakest)}`);
    }
    rejectedBecause[alt.id] = reasons;
  }
  return { selectedBecause, rejectedBecause };
}
