import { UUID } from "../types";
import { clone } from "../persistence/clone";
import { User } from "./types";
import { UserRepository } from "./UserRepository";

/**
 * In-memory implementation of UserRepository. Every entry is
 * deep-cloned on the way in and out (see persistence/clone.ts), same
 * defensive-copy guarantee as every other in-memory repository in this
 * codebase.
 */
export class InMemoryUserRepository implements UserRepository {
  private byId = new Map<UUID, User>();
  private byEmail = new Map<string, UUID>();

  async create(user: User): Promise<void> {
    this.byId.set(user.id, clone(user));
    this.byEmail.set(user.email, user.id);
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const id = this.byEmail.get(email);
    if (id === undefined) return undefined;
    const user = this.byId.get(id);
    return user ? clone(user) : undefined;
  }

  async findById(id: UUID): Promise<User | undefined> {
    const user = this.byId.get(id);
    return user ? clone(user) : undefined;
  }
}
