import type { UUID } from "../types";
import { clone } from "../persistence/clone";
import type { CalendarConnectionRepository } from "./CalendarConnectionRepository";
import type { CalendarConnection } from "./types";

export class InMemoryCalendarConnectionRepository implements CalendarConnectionRepository {
  private readonly byUserId = new Map<UUID, CalendarConnection>();

  async upsert(connection: CalendarConnection): Promise<void> {
    this.byUserId.set(connection.userId, clone(connection));
  }

  async findByUserId(userId: UUID): Promise<CalendarConnection | null> {
    const found = this.byUserId.get(userId);
    return found === undefined ? null : clone(found);
  }

  async delete(userId: UUID): Promise<void> {
    this.byUserId.delete(userId);
  }
}
