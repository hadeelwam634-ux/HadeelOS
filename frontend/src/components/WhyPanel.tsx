import { useI18n } from "../i18n";
import type { TodayConfidence } from "../api/types";

export function WhyPanel({ confidence }: { confidence: TodayConfidence }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="why-heading">
      <h3 id="why-heading">{t.why.heading}</h3>
      {confidence.contributors.length === 0 ? (
        <p>{t.why.empty}</p>
      ) : (
        <ul className="list-reset">
          {confidence.contributors.map((c) => (
            <li key={c.name}>
              {c.name} — {Math.round(c.contribution * 100)}%
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
