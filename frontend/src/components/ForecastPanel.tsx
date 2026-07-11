import { useI18n } from "../i18n";
import type { TodayForecast } from "../api/types";

export function ForecastPanel({ forecast }: { forecast: TodayForecast }) {
  const { t } = useI18n();
  return (
    <section className="card" aria-labelledby="forecast-heading">
      <h3 id="forecast-heading">{t.forecast.heading}</h3>
      <ul className="list-reset">
        <li>
          {t.forecast.completion}: <strong>{Math.round(forecast.completion)}%</strong>
        </li>
        <li>
          {t.forecast.capacity}: <strong>{Math.round(forecast.capacity)}%</strong>
        </li>
        <li>
          {t.forecast.stress}: <strong>{Math.round(forecast.stress * 100)}%</strong>
        </li>
      </ul>
    </section>
  );
}
