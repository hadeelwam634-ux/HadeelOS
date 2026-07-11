import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithI18n } from "../test/renderWithI18n";
import { LanguageToggle } from "../components/LanguageToggle";
import { useI18n } from "./index";

function DirProbe() {
  const { dir, t } = useI18n();
  return <span data-testid="dir">{dir}:{t.today.title}</span>;
}

describe("i18n", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to Arabic/RTL and toggles to English/LTR on one coherent screen", async () => {
    renderWithI18n(
      <>
        <LanguageToggle />
        <DirProbe />
      </>
    );

    expect(screen.getByTestId("dir")).toHaveTextContent("rtl:اليوم");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByTestId("dir")).toHaveTextContent("ltr:Today");
  });

  it("persists the language choice across a re-render (localStorage)", async () => {
    const { unmount } = renderWithI18n(
      <>
        <LanguageToggle />
        <DirProbe />
      </>
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "English" }));
    unmount();

    renderWithI18n(<DirProbe />);
    expect(screen.getByTestId("dir")).toHaveTextContent("ltr:Today");
  });
});
