import { DigitalTwinSnapshot, UUID } from "../types";
import { clone } from "../persistence/clone";
import { DigitalTwinRepository } from "./DigitalTwinRepository";
import { DuplicateDigitalTwinSnapshotError } from "./errors";

/**
 * In-memory implementation of DigitalTwinRepository. Every entry is
 * deep-cloned (structuredClone, via ../persistence/clone) on the way in
 * and on the way out, mirroring every other repository in this
 * codebase, so neither the caller's original object nor a
 * previously-returned result can be mutated to silently rewrite stored
 * twin history.
 */
export class InMemoryDigitalTwinRepository implements DigitalTwinRepository {
  private snapshots = new Map<UUID, DigitalTwinSnapshot>();
  /** Per-user insertion order — never mutated or spliced, only appended to. */
  private byUser = new Map<UUID, UUID[]>();

  async save(snapshot: DigitalTwinSnapshot): Promise<void> {
    if (this.snapshots.has(snapshot.id)) {
      throw new DuplicateDigitalTwinSnapshotError(snapshot.id);
    }
    this.snapshots.set(snapshot.id, clone(snapshot));
    const order = this.byUser.get(snapshot.userId) ?? [];
    order.push(snapshot.id);
    this.byUser.set(snapshot.userId, order);
  }

  async getById(id: UUID): Promise<DigitalTwinSnapshot | undefined> {
    const snapshot = this.snapshots.get(id);
    return snapshot === undefined ? undefined : clone(snapshot);
  }

  async getLatest(userId: UUID): Promise<DigitalTwinSnapshot | undefined> {
    const order = this.byUser.get(userId);
    if (order === undefined || order.length === 0) return undefined;
    return clone(this.snapshots.get(order[order.length - 1])!);
  }

  async getHistory(userId: UUID): Promise<DigitalTwinSnapshot[]> {
    const order = this.byUser.get(userId) ?? [];
    return order.map((id) => clone(this.snapshots.get(id)!));
  }
}
