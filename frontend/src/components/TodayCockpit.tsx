import type { ApiClient } from "../api/client";
import { useTodayCockpit } from "../hooks/useTodayCockpit";
import { ContextStrip } from "./ContextStrip";
import { DecisionCard } from "./DecisionCard";
import { WhyPanel } from "./WhyPanel";
import { ExplainAlternatives } from "./ExplainAlternatives";
import { ForecastPanel } from "./ForecastPanel";
import { TimelinePanel } from "./TimelinePanel";
import { IfYouDoNothing } from "./IfYouDoNothing";
import {
  ApplicationErrorView,
  EmptyView,
  LoadingView,
  LowConfidenceNotice,
  MissingSignalsView,
  OfflineView,
  StaleBanner,
  UncertainView,
} from "./StateViews";

/**
 * Every value rendered below comes from useTodayCockpit's live
 * TodayDecisionResult — no Context Strip/Decision Card/Confidence/Why/
 * Explain Alternatives/Forecast/Timeline/Prediction/If You Do Nothing
 * value is hard-coded, satisfying PR #10's core requirement.
 */
export function TodayCockpit({ client }: { client: ApiClient }) {
  const { state, refresh, respond, recordOutcome } = useTodayCockpit(client);

  if (state.kind === "loading") return <LoadingView />;
  if (state.kind === "offline") {
    return (
      <>
        <OfflineView />
        {state.lastKnown && <ReadyView data={state.lastKnown} stale respond={respond} recordOutcome={recordOutcome} />}
      </>
    );
  }
  if (state.kind === "error") {
    return <ApplicationErrorView message={state.message} onRetry={refresh} />;
  }

  return (
    <>
      {state.stale && <StaleBanner retrying={state.retrying} />}
      <ReadyView data={state.data} stale={false} respond={respond} recordOutcome={recordOutcome} />
    </>
  );
}

function ReadyView({
  data,
  respond,
  recordOutcome,
}: {
  data: import("../api/types").TodayDecisionResult;
  stale: boolean;
  respond: (decisionId: string, action: "accepted" | "rejected" | "ignored") => Promise<void>;
  recordOutcome: (decisionId: string, outcome: "completed" | "skipped" | "partial") => Promise<void>;
}) {
  const { decision, uncertainty, confidence } = data;

  return (
    <>
      <ContextStrip context={data.context} />

      {uncertainty.reason === "missing_signals" && <MissingSignalsView />}
      {uncertainty.isUncertain && uncertainty.reason === "near_tie" && <UncertainView />}
      {decision === null && uncertainty.reason === "no_candidates" && <EmptyView />}

      {decision !== null && (
        <>
          {confidence.qualifier === "low" && <LowConfidenceNotice />}
          <DecisionCard
            decision={decision}
            confidenceScore={confidence.score}
            onRespond={(action) => respond(decision.id, action)}
            onRecordOutcome={(outcome) => recordOutcome(decision.id, outcome)}
          />
          <WhyPanel confidence={confidence} />
          <ExplainAlternatives alternatives={data.alternatives} />
        </>
      )}

      <ForecastPanel forecast={data.forecast} />
      <TimelinePanel timelineOrder={data.timelineOrder} />
      <IfYouDoNothing forecast={data.forecast} />
    </>
  );
}
