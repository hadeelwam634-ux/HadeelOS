import { EventLogEntry, UUID } from "../types";
import { EventLogRepository } from "./EventLogRepository";

/**
 * In-memory implementation of EventLogRepository. Entries are stored in
 * a plain array in insertion order and are never mutated or removed
 * after being appended — this class exposes no method that could do
 * either, matching the interface's append-only contract.
 */
export class InMemoryEventLogRepository implements EventLogRepository {
  private entries: EventLogEntry[] = [];

  async append(entry: EventLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async findByDecisionId(decisionId: UUID): Promise<EventLogEntry[]> {
    // Return a copy so callers can't mutate our internal history.
    return this.entries.filter((e) => e.decisionId === decisionId).slice();
  }

  async getAll(): Promise<EventLogEntry[]> {
    return this.entries.slice();
  }
}
