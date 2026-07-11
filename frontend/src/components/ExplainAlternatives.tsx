import { useI18n } from "../i18n";
import type { DecisionAlternative } from "../api/types";

export function ExplainAlternatives({ alternatives }: { alternatives: DecisionAlternative[] }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="alternatives-heading">
      <h3 id="alternatives-heading">{t.alternatives.heading}</h3>
      {alternatives.length === 0 ? (
        <p>{t.alternatives.empty}</p>
      ) : (
        <ul className="list-reset">
          {alternatives.map((alt) => (
            <li key={alt.action}>
              <strong>{alt.action}</strong> — {t.alternatives.predictedSuccess}:{" "}
              {Math.round(alt.predictedSuccess * 100)}%
              {alt.rejectionReason && (
                <>
                  {" "}
                  · {t.alternatives.rejectionReason}: {alt.rejectionReason}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
