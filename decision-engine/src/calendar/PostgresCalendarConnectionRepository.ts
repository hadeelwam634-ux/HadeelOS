import type { UUID } from "../types";
import type { CalendarConnection } from "./types";
import type { CalendarConnectionRepository } from "./CalendarConnectionRepository";
import { Queryable } from "../persistence/postgres/Queryable";
import { decryptNullableToken, encryptNullableToken } from "../security/tokenCipher";

interface Row {
  user_id: string;
  calendar_id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string | null;
  expires_at: string | Date;
  connected_at: string | Date;
}

function fromRow(row: Row): CalendarConnection {
  return {
    userId: row.user_id as UUID,
    calendarId: row.calendar_id,
    accessToken: decryptNullableToken(row.access_token_encrypted)!,
    refreshToken: decryptNullableToken(row.refresh_token_encrypted),
    expiresAt: new Date(row.expires_at).toISOString(),
    connectedAt: new Date(row.connected_at).toISOString(),
  };
}

/**
 * Postgres-backed CalendarConnectionRepository. Fulfils the SECURITY
 * NOTE on CalendarConnection: accessToken/refreshToken are encrypted
 * with AES-256-GCM (src/security/tokenCipher.ts) before ever reaching
 * the database, and decrypted only in-process on read. The encryption
 * key (TOKEN_ENCRYPTION_KEY) never touches this file or the database —
 * see tokenCipher.ts for where it's loaded from.
 */
export class PostgresCalendarConnectionRepository implements CalendarConnectionRepository {
  constructor(private readonly db: Queryable) {}

  async upsert(connection: CalendarConnection): Promise<void> {
    await this.db.query(
      `INSERT INTO calendar_connections
         (user_id, calendar_id, access_token_encrypted, refresh_token_encrypted, expires_at, connected_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         calendar_id = EXCLUDED.calendar_id,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         expires_at = EXCLUDED.expires_at,
         connected_at = EXCLUDED.connected_at`,
      [
        connection.userId,
        connection.calendarId,
        encryptNullableToken(connection.accessToken),
        encryptNullableToken(connection.refreshToken),
        connection.expiresAt,
        connection.connectedAt,
      ],
    );
  }

  async findByUserId(userId: UUID): Promise<CalendarConnection | null> {
    const res = await this.db.query<Row>(`SELECT * FROM calendar_connections WHERE user_id = $1`, [userId]);
    return res.rows[0] ? fromRow(res.rows[0]) : null;
  }

  async delete(userId: UUID): Promise<void> {
    await this.db.query(`DELETE FROM calendar_connections WHERE user_id = $1`, [userId]);
  }
}
