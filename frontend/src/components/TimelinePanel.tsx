import { useI18n } from "../i18n";

export function TimelinePanel({ timelineOrder }: { timelineOrder: string[] }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="timeline-heading">
      <h3 id="timeline-heading">{t.timeline.heading}</h3>
      {timelineOrder.length === 0 ? (
        <p>{t.timeline.empty}</p>
      ) : (
        <ol className="list-reset">
          {timelineOrder.map((item, index) => (
            <li key={`${item}-${index}`}>{item}</li>
          ))}
        </ol>
      )}
    </section>
  );
}
