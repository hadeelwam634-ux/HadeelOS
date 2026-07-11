import { useI18n } from "../i18n";

export function LoadingView() {
  const { t } = useI18n();
  return (
    <div className="card" role="status" aria-live="polite">
      {t.today.loading}
    </div>
  );
}

export function OfflineView() {
  const { t } = useI18n();
  return (
    <div className="status-banner offline" role="alert">
      {t.today.offline}
    </div>
  );
}

export function StaleBanner({ retrying }: { retrying: boolean }) {
  const { t } = useI18n();
  return (
    <div className="status-banner stale" role="status" aria-live="polite">
      {retrying ? t.today.retrying : t.today.stale}
    </div>
  );
}

export function ApplicationErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="status-banner" role="alert">
      <p>{t.today.applicationError}</p>
      <p className="sr-only">{message}</p>
      <button type="button" onClick={onRetry}>
        {t.today.retry}
      </button>
    </div>
  );
}

export function EmptyView() {
  const { t } = useI18n();
  return <div className="card">{t.today.empty}</div>;
}

export function MissingSignalsView() {
  const { t } = useI18n();
  return (
    <div className="status-banner" role="status">
      {t.today.missingSignals}
    </div>
  );
}

export function UncertainView() {
  const { t } = useI18n();
  return (
    <div className="status-banner" role="status">
      {t.today.uncertain}
    </div>
  );
}

export function LowConfidenceNotice() {
  const { t } = useI18n();
  return (
    <div className="status-banner" role="status">
      {t.today.lowConfidence}
    </div>
  );
}

export function PartialConnectorFailureBanner() {
  const { t } = useI18n();
  return (
    <div className="status-banner" role="status">
      {t.today.partialConnectorFailure}
    </div>
  );
}
