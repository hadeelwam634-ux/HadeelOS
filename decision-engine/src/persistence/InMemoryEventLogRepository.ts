import { EventLogEntry, UUID } from "../types";
import { DuplicateEventLogEntryError, EventLogRepository } from "./EventLogRepository";
import { clone } from "./clone";

/**
 * In-memory implementation of EventLogRepository. Entries are stored in
 * a plain array in insertion order and are never mutated or removed
 * after being appended — this class exposes no method that could do
 * either, matching the interface's append-only contract.
 *
 * Every entry is deep-cloned on the way in (append) and on the way out
 * (getAll/findByDecisionId), so neither the caller's original object
 * nor a previously-returned result can be mutated to silently rewrite
 * stored history. Duplicate ids are rejected the same way a real
 * database's primary key would reject them.
 */
export class InMemoryEventLogRepository implements EventLogRepository {
  private entries: EventLogEntry[] = [];

  async append(entry: EventLogEntry): Promise<void> {
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new DuplicateEventLogEntryError(entry.id);
    }
    this.entries.push(clone(entry));
  }

  async findByDecisionId(decisionId: UUID): Promise<EventLogEntry[]> {
    return clone(this.entries.filter((e) => e.decisionId === decisionId));
  }

  async getAll(): Promise<EventLogEntry[]> {
    return clone(this.entries);
  }
}
