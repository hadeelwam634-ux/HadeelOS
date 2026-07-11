import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { I18nProvider } from "../i18n";

export function renderWithI18n(ui: ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}
