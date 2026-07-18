import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { ApiClient } from "../api/client";
import type { PublicCalendarConnection, PublicGmailConnection } from "../api/types";

/**
 * MVP Hardening: minimal UI for the Calendar/Gmail integrations that
 * previously only existed as backend routes (PR #13/#14) with no
 * frontend surface at all. "Connect (mock)" is deliberate — see
 * ApiClient.connectCalendarMock()/connectGmailMock()'s doc comments —
 * this build never performs a real Google OAuth redirect; it exercises
 * the same connect/sync/disconnect backend flow using a self-issued
 * fake token pair, consistent with the FakeCalendarProvider/
 * FakeGmailProvider AppContainer defaults.
 */
export function ConnectorsPanel({ client }: { client: ApiClient }) {
  const { t } = useI18n();
  const [calendar, setCalendar] = useState<PublicCalendarConnection | null | undefined>(undefined);
  const [gmail, setGmail] = useState<PublicGmailConnection | null | undefined>(undefined);
  const [busy, setBusy] = useState<"calendar" | "gmail" | null>(null);

  const load = async () => {
    const [calRes, gmailRes] = await Promise.all([client.getCalendarConnection(), client.getGmailConnection()]);
    setCalendar(calRes.connection);
    setGmail(gmailRes.connection);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  return (
    <section className="card" aria-labelledby="connectors-heading">
      <h2 id="connectors-heading">{t.connectors.heading}</h2>
      <ul className="list-reset">
        <li className="connector-row">
          <span>
            {t.connectors.calendarLabel} —{" "}
            {calendar === undefined
              ? "…"
              : calendar === null
                ? t.connectors.notConnected
                : `${t.connectors.connected} (${calendar.calendarId})`}
          </span>
          <button
            type="button"
            disabled={busy === "calendar"}
            onClick={async () => {
              setBusy("calendar");
              try {
                if (calendar) {
                  await client.disconnectCalendar();
                } else {
                  await client.connectCalendarMock();
                }
                await load();
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "calendar" ? t.connectors.connecting : calendar ? t.connectors.disconnect : t.connectors.connect}
          </button>
        </li>
        <li className="connector-row">
          <span>
            {t.connectors.gmailLabel} —{" "}
            {gmail === undefined ? "…" : gmail === null ? t.connectors.notConnected : t.connectors.connected}
          </span>
          <button
            type="button"
            disabled={busy === "gmail"}
            onClick={async () => {
              setBusy("gmail");
              try {
                if (gmail) {
                  await client.disconnectGmail();
                } else {
                  await client.connectGmailMock();
                }
                await load();
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "gmail" ? t.connectors.connecting : gmail ? t.connectors.disconnect : t.connectors.connect}
          </button>
        </li>
      </ul>
    </section>
  );
}
