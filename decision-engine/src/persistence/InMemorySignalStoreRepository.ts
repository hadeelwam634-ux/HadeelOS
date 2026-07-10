import { SignalStore, SignalStoreEntry, SignalType } from "../types";
import { SignalStoreRepository } from "./SignalStoreRepository";

/**
 * In-memory implementation of SignalStoreRepository. This is the
 * initial storage backend; a future PostgresSignalStoreRepository (or
 * any other) replaces it by implementing the same interface — nothing
 * outside this file should ever import Map or know this is in-memory.
 */
export class InMemorySignalStoreRepository implements SignalStoreRepository {
  private store = new Map<SignalType, SignalStoreEntry>();

  async upsert(entry: SignalStoreEntry): Promise<void> {
    this.store.set(entry.signalType, entry);
  }

  async upsertMany(entries: SignalStoreEntry[]): Promise<void> {
    for (const entry of entries) {
      this.store.set(entry.signalType, entry);
    }
  }

  async get(signalType: SignalType): Promise<SignalStoreEntry | undefined> {
    return this.store.get(signalType);
  }

  async getAll(): Promise<SignalStore> {
    const result: SignalStore = {};
    for (const [type, entry] of this.store) {
      result[type] = entry;
    }
    return result;
  }

  async delete(signalType: SignalType): Promise<void> {
    this.store.delete(signalType);
  }
}
