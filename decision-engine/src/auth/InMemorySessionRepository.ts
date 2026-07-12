import { clone } from "../persistence/clone";
import { Session } from "./types";
import { SessionRepository } from "./SessionRepository";

export class InMemorySessionRepository implements SessionRepository {
  private sessions = new Map<string, Session>();

  async create(session: Session): Promise<void> {
    this.sessions.set(session.token, clone(session));
  }

  async findByToken(token: string): Promise<Session | undefined> {
    const session = this.sessions.get(token);
    return session ? clone(session) : undefined;
  }

  async revoke(token: string): Promise<void> {
    this.sessions.delete(token);
  }
}
