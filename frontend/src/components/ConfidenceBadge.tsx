import { useI18n } from "../i18n";
import type { ConfidenceQualifier } from "../api/types";

export function ConfidenceBadge({ qualifier, score }: { qualifier: ConfidenceQualifier; score: number }) {
  const { t } = useI18n();
  return (
    <span className={`pill ${qualifier}`}>
      {t.confidence.heading}: {t.confidence[qualifier]} ({Math.round(score * 100)}%)
    </span>
  );
}
