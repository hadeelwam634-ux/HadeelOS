import { UUID } from "../types";
import { User } from "./types";
import { UserRepository } from "./UserRepository";
import { Queryable } from "../persistence/postgres/Queryable";

interface Row {
  id: string;
  email: string;
  password_hash: string;
  created_at: string | Date;
}

function fromRow(row: Row): User {
  return {
    id: row.id as UUID,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

/**
 * Postgres-backed UserRepository — the app-wide (not per-container)
 * table of registered accounts. passwordHash is already a salted
 * derived key (see passwordHashing.ts), never plaintext, so no
 * additional encryption is applied here.
 */
export class PostgresUserRepository implements UserRepository {
  constructor(private readonly db: Queryable) {}

  async create(user: User): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)`,
        [user.id, user.email, user.passwordHash, user.createdAt],
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Mirrors InMemoryUserRepository: AuthService is responsible for
        // checking findByEmail() before calling create() and surfacing
        // its own DuplicateEmailError; this constraint is a last-resort
        // integrity backstop, not the primary duplicate-email check, so
        // it re-throws the raw error rather than inventing a new type.
        throw err;
      }
      throw err;
    }
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const res = await this.db.query<Row>(`SELECT * FROM users WHERE email = $1`, [email]);
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async findById(id: UUID): Promise<User | undefined> {
    const res = await this.db.query<Row>(`SELECT * FROM users WHERE id = $1`, [id]);
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }
}
