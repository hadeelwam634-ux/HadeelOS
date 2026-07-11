import { useI18n } from "../i18n";
import type { TodayContext } from "../api/types";

export function ContextStrip({ context }: { context: TodayContext }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="context-strip-heading">
      <h2 id="context-strip-heading">{t.context.heading}</h2>
      <ul className="list-reset">
        <li>
          {t.context.signalCount}: <strong>{context.signalCount}</strong>
        </li>
        <li>
          {t.context.missingSignals}:{" "}
          <strong>{context.missingSignals.length > 0 ? context.missingSignals.join("، ") : "—"}</strong>
        </li>
        <li>
          {t.context.generatedAt}: <strong>{new Date(context.generatedAt).toLocaleString()}</strong>
        </li>
        {context.graphVersion && (
          <li>
            {t.context.graphVersion}: <strong>{context.graphVersion}</strong>
          </li>
        )}
      </ul>
    </section>
  );
}
