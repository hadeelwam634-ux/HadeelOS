import { Session } from "./types";
import { SessionRepository } from "./SessionRepository";
import { Queryable } from "../persistence/postgres/Queryable";

interface Row {
  token: string;
  user_id: string;
  created_at: string | Date;
  expires_at: string | Date;
}

function fromRow(row: Row): Session {
  return {
    token: row.token,
    userId: row.user_id as Session["userId"],
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

/**
 * Postgres-backed SessionRepository — the app-wide (not per-container)
 * table of live login sessions. Sessions surviving a process restart
 * is the whole point of moving this off InMemorySessionRepository (see
 * tests/persistence/postgres/restart.test.ts).
 */
export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly db: Queryable) {}

  async create(session: Session): Promise<void> {
    await this.db.query(
      `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`,
      [session.token, session.userId, session.createdAt, session.expiresAt],
    );
  }

  async findByToken(token: string): Promise<Session | undefined> {
    const res = await this.db.query<Row>(`SELECT * FROM sessions WHERE token = $1`, [token]);
    return res.rows[0] ? fromRow(res.rows[0]) : undefined;
  }

  async revoke(token: string): Promise<void> {
    await this.db.query(`DELETE FROM sessions WHERE token = $1`, [token]);
  }
}
