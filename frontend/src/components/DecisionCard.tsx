import { useState } from "react";
import { useI18n } from "../i18n";
import type { Decision } from "../api/types";
import { ConfidenceBadge } from "./ConfidenceBadge";

export interface DecisionCardProps {
  decision: Decision;
  confidenceScore: number;
  onRespond: (action: "accepted" | "rejected" | "ignored") => Promise<void>;
  onRecordOutcome: (outcome: "completed" | "skipped" | "partial") => Promise<void>;
}

export function DecisionCard({ decision, confidenceScore, onRespond, onRecordOutcome }: DecisionCardProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const [responded, setResponded] = useState<"accepted" | "rejected" | "ignored" | null>(null);

  const handleRespond = async (action: "accepted" | "rejected" | "ignored") => {
    setBusy(action);
    try {
      await onRespond(action);
      setResponded(action);
    } finally {
      setBusy(null);
    }
  };

  const handleOutcome = async (outcome: "completed" | "skipped" | "partial") => {
    setBusy(outcome);
    try {
      await onRecordOutcome(outcome);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-labelledby="decision-heading">
      <h2 id="decision-heading">{t.decision.heading}</h2>
      <p style={{ fontSize: "1.1rem", fontWeight: 600 }}>{decision.proposedAction}</p>
      <ConfidenceBadge qualifier={decision.confidenceQualifier} score={confidenceScore} />

      {responded === null ? (
        <div className="actions" role="group" aria-label={t.decision.heading}>
          <button
            type="button"
            data-variant="accept"
            onClick={() => handleRespond("accepted")}
            disabled={busy !== null}
          >
            {t.decision.accept}
          </button>
          <button
            type="button"
            data-variant="reject"
            onClick={() => handleRespond("rejected")}
            disabled={busy !== null}
          >
            {t.decision.reject}
          </button>
          <button type="button" onClick={() => handleRespond("ignored")} disabled={busy !== null}>
            {t.decision.ignore}
          </button>
        </div>
      ) : (
        <>
          <p role="status">
            {responded === "accepted" && t.decision.accepted}
            {responded === "rejected" && t.decision.rejected}
            {responded === "ignored" && t.decision.ignored}
          </p>
          {responded === "accepted" && (
            <div className="actions" role="group" aria-label={t.decision.recordOutcome}>
              <button type="button" onClick={() => handleOutcome("completed")} disabled={busy !== null}>
                {t.decision.outcomeCompleted}
              </button>
              <button type="button" onClick={() => handleOutcome("skipped")} disabled={busy !== null}>
                {t.decision.outcomeSkipped}
              </button>
              <button type="button" onClick={() => handleOutcome("partial")} disabled={busy !== null}>
                {t.decision.outcomePartial}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
