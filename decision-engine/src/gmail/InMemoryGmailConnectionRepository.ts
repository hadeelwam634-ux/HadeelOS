import type { UUID } from "../types";
import { clone } from "../persistence/clone";
import type { GmailConnectionRepository } from "./GmailConnectionRepository";
import type { GmailConnection } from "./types";

export class InMemoryGmailConnectionRepository implements GmailConnectionRepository {
  private readonly byUserId = new Map<UUID, GmailConnection>();

  async upsert(connection: GmailConnection): Promise<void> {
    this.byUserId.set(connection.userId, clone(connection));
  }

  async findByUserId(userId: UUID): Promise<GmailConnection | null> {
    const found = this.byUserId.get(userId);
    return found === undefined ? null : clone(found);
  }

  async delete(userId: UUID): Promise<void> {
    this.byUserId.delete(userId);
  }
}
