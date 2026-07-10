import { SignalStore, SignalStoreEntry, SignalType } from "../types";
import { SignalStoreRepository } from "./SignalStoreRepository";
import { clone } from "./clone";

/**
 * In-memory implementation of SignalStoreRepository. This is the
 * initial storage backend; a future PostgresSignalStoreRepository (or
 * any other) replaces it by implementing the same interface — nothing
 * outside this file should ever import Map or know this is in-memory.
 *
 * Every entry is deep-cloned on the way in (upsert/upsertMany) and on
 * the way out (get/getAll), so neither the caller's original object nor
 * a previously-returned result can be mutated to silently rewrite what
 * the store believes is the latest known value.
 */
export class InMemorySignalStoreRepository implements SignalStoreRepository {
  private store = new Map<SignalType, SignalStoreEntry>();

  async upsert(entry: SignalStoreEntry): Promise<void> {
    this.store.set(entry.signalType, clone(entry));
  }

  async upsertMany(entries: SignalStoreEntry[]): Promise<void> {
    for (const entry of entries) {
      this.store.set(entry.signalType, clone(entry));
    }
  }

  async get(signalType: SignalType): Promise<SignalStoreEntry | undefined> {
    const entry = this.store.get(signalType);
    return entry === undefined ? undefined : clone(entry);
  }

  async getAll(): Promise<SignalStore> {
    const result: SignalStore = {};
    for (const [type, entry] of this.store) {
      result[type] = clone(entry);
    }
    return result;
  }

  async delete(signalType: SignalType): Promise<void> {
    this.store.delete(signalType);
  }
}
