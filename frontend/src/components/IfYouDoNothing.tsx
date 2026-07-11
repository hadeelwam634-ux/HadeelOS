import { useI18n } from "../i18n";
import type { TodayForecast } from "../api/types";

/**
 * Message is derived purely from the live forecast.stress value, never
 * a hard-coded string picked by decision type — PR #10's rule that no
 * component may contain prototype/hard-coded data.
 */
export function IfYouDoNothing({ forecast }: { forecast: TodayForecast }) {
  const { t } = useI18n();
  const message = forecast.stress >= 0.6 ? t.ifYouDoNothing.highStress : t.ifYouDoNothing.default;
  return (
    <section className="card" aria-labelledby="if-nothing-heading">
      <h3 id="if-nothing-heading">{t.ifYouDoNothing.heading}</h3>
      <p>{message}</p>
    </section>
  );
}
