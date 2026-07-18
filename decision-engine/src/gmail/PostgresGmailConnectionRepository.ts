import type { UUID } from "../types";
import type { GmailConnection } from "./types";
import type { GmailConnectionRepository } from "./GmailConnectionRepository";
import { Queryable } from "../persistence/postgres/Queryable";
import { decryptNullableToken, encryptNullableToken } from "../security/tokenCipher";

interface Row {
  user_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | Date;
  connected_at: string | Date;
}

function fromRow(row: Row): GmailConnection {
  return {
    userId: row.user_id as UUID,
    accessToken: decryptNullableToken(row.access_token_encrypted)!,
    refreshToken: decryptNullableToken(row.refresh_token_encrypted),
    expiresAt: new Date(row.expires_at).toISOString(),
    connectedAt: new Date(row.connected_at).toISOString(),
  };
}

/**
 * Postgres-backed GmailConnectionRepository. Same encryption-at-rest
 * guarantee as PostgresCalendarConnectionRepository — see that class's
 * doc comment and src/security/tokenCipher.ts.
 */
export class PostgresGmailConnectionRepository implements GmailConnectionRepository {
  constructor(private readonly db: Queryable) {}

  async upsert(connection: GmailConnection): Promise<void> {
    await this.db.query(
      `INSERT INTO gmail_connections
         (user_id, access_token_encrypted, refresh_token_encrypted, expires_at, connected_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         expires_at = EXCLUDED.expires_at,
         connected_at = EXCLUDED.connected_at`,
      [
        connection.userId,
        encryptNullableToken(connection.accessToken),
        encryptNullableToken(connection.refreshToken),
        connection.expiresAt,
        connection.connectedAt,
      ],
    );
  }

  async findByUserId(userId: UUID): Promise<GmailConnection | null> {
    const res = await this.db.query<Row>(`SELECT * FROM gmail_connections WHERE user_id = $1`, [userId]);
    return res.rows[0] ? fromRow(res.rows[0]) : null;
  }

  async delete(userId: UUID): Promise<void> {
    await this.db.query(`DELETE FROM gmail_connections WHERE user_id = $1`, [userId]);
  }
}
