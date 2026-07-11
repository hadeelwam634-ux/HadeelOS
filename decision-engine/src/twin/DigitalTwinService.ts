import {
  DigitalTwinSnapshot,
  DigitalTwinSourceVersions,
  MemoryRecord,
  SignalStore,
  UUID,
} from "../types";
import { Clock, IdGenerator } from "../application/types";
import { DigitalTwinRepository } from "./DigitalTwinRepository";
import {
  deriveActiveConstraints,
  deriveBehaviorPatterns,
  deriveDecisionStyle,
  deriveEnergyCurve,
  deriveKnownPreferences,
  deriveStress,
} from "./TwinDerivationPolicy";

export interface DeriveTwinInput {
  userId: UUID;
  signalStore: SignalStore;
  /**
   * Every memory the caller has for this user (typically from
   * MemoryMapService.getMemoryMap()) — not pre-filtered. Filtering out
   * blocked and not-yet-Known memories is TwinDerivationPolicy's job,
   * not the caller's, so a blocked memory can never leak into a twin
   * no matter what the caller passes in.
   */
  memories: MemoryRecord[];
  sourceVersions: DigitalTwinSourceVersions;
}

/**
 * Thin orchestration layer over DigitalTwinRepository — the only place
 * that constructs a DigitalTwinSnapshot's id/derivedAt and the only
 * place that calls DigitalTwinRepository directly. Every derivation
 * rule itself lives in TwinDerivationPolicy.ts (pure functions); this
 * service only wires the injected IdGenerator/Clock into that pure
 * derivation and persists the result.
 */
export class DigitalTwinService {
  constructor(
    private readonly repository: DigitalTwinRepository,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock
  ) {}

  async deriveAndPersist(input: DeriveTwinInput): Promise<DigitalTwinSnapshot> {
    const snapshot: DigitalTwinSnapshot = {
      id: this.idGenerator.next(),
      userId: input.userId,
      derivedAt: this.clock.now(),
      stress: deriveStress(input.signalStore),
      energyCurve: deriveEnergyCurve(input.signalStore),
      decisionStyle: deriveDecisionStyle(input.memories),
      behaviorPatterns: deriveBehaviorPatterns(input.memories),
      knownPreferences: deriveKnownPreferences(input.memories),
      activeConstraints: deriveActiveConstraints(input.memories),
      sourceVersions: input.sourceVersions,
    };
    await this.repository.save(snapshot);
    return snapshot;
  }

  async getLatest(userId: UUID): Promise<DigitalTwinSnapshot | undefined> {
    return this.repository.getLatest(userId);
  }

  async getHistory(userId: UUID): Promise<DigitalTwinSnapshot[]> {
    return this.repository.getHistory(userId);
  }
}
