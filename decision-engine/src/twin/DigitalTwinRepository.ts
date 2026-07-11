import { DigitalTwinSnapshot, UUID } from "../types";

/**
 * Storage-agnostic contract for persisted DigitalTwinSnapshot history.
 * Like every other repository in this codebase, every method returns a
 * Promise and every implementation is expected to defensively clone at
 * both write and read boundaries. IDs and timestamps are never
 * generated inside a repository implementation — DigitalTwinService
 * (which holds the injected IdGenerator/Clock) supplies a fully-formed
 * snapshot to save().
 */
export interface DigitalTwinRepository {
  /** Throws DuplicateDigitalTwinSnapshotError if snapshot.id already exists. */
  save(snapshot: DigitalTwinSnapshot): Promise<void>;

  getById(id: UUID): Promise<DigitalTwinSnapshot | undefined>;

  /** The most recently saved snapshot for userId, or undefined if none exists yet. */
  getLatest(userId: UUID): Promise<DigitalTwinSnapshot | undefined>;

  /** Every snapshot ever saved for userId, in insertion order. */
  getHistory(userId: UUID): Promise<DigitalTwinSnapshot[]>;
}
