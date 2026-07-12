import { UUID } from "../types";
import { User } from "./types";

/**
 * Storage-agnostic contract for registered users, matching the pattern
 * every other repository in this codebase follows (see
 * persistence/SignalStoreRepository.ts): swap InMemoryUserRepository
 * for a Postgres-backed one later without any caller changing.
 */
export interface UserRepository {
  /** Throws if a user with this exact id already exists. */
  create(user: User): Promise<void>;
  findByEmail(email: string): Promise<User | undefined>;
  findById(id: UUID): Promise<User | undefined>;
}
