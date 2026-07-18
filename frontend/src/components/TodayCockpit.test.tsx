import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient } from "../api/client";
import { TodayCockpit } from "./TodayCockpit";
import { renderWithI18n } from "../test/renderWithI18n";
import { makeTodayResult } from "../test/mockToday";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TodayCockpit", () => {
  it("renders the live decision, forecast, and timeline — no hard-coded prototype values", async () => {
    const data = makeTodayResult();
    vi.spyOn(ApiClient.prototype, "getToday").mockResolvedValue(data);

    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    expect(await screen.findByText(data.decision!.proposedAction)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument(); // completion
    expect(screen.getByText(data.alternatives[0].action)).toBeInTheDocument();
  });

  it("shows the empty state when there are no candidate decisions", async () => {
    vi.spyOn(ApiClient.prototype, "getToday").mockResolvedValue(
      makeTodayResult({ decision: null, uncertainty: { isUncertain: true, reason: "no_candidates" } })
    );
    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    expect(await screen.findByText("لا توجد قرارات مرشّحة اليوم بعد.")).toBeInTheDocument();
  });

  it("shows the missing-signals state", async () => {
    vi.spyOn(ApiClient.prototype, "getToday").mockResolvedValue(
      makeTodayResult({ decision: null, uncertainty: { isUncertain: true, reason: "missing_signals" } })
    );
    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    expect(await screen.findByText("لا تتوفر إشارات كافية بعد لاتخاذ قرار واثق.")).toBeInTheDocument();
  });

  it("shows the uncertain (near-tie) state", async () => {
    vi.spyOn(ApiClient.prototype, "getToday").mockResolvedValue(
      makeTodayResult({ uncertainty: { isUncertain: true, reason: "near_tie", margin: 0.01 } })
    );
    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    expect(await screen.findByText("النتائج متقاربة جدًا — لا يوجد خيار واضح بعد.")).toBeInTheDocument();
  });

  it("shows a low-confidence notice when the qualifier is low", async () => {
    vi.spyOn(ApiClient.prototype, "getToday").mockResolvedValue(
      makeTodayResult({ confidence: { score: 0.1, qualifier: "low", contributors: [] } })
    );
    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    expect(await screen.findByText("الثقة بهذا القرار منخفضة حاليًا.")).toBeInTheDocument();
  });

  it("shows the application error state and lets the user retry", async () => {
    const spy = vi
      .spyOn(ApiClient.prototype, "getToday")
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeTodayResult());
    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    expect(await screen.findByText("حدث خطأ غير متوقع أثناء تحميل قرار اليوم.")).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("accepting a decision calls respond() and then shows outcome controls", async () => {
    vi.spyOn(ApiClient.prototype, "getToday").mockResolvedValue(makeTodayResult());
    const respondSpy = vi
      .spyOn(ApiClient.prototype, "respondToDecision")
      .mockResolvedValue({ entry: {} as never });

    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<TodayCockpit client={client} />);

    const acceptButton = await screen.findByRole("button", { name: "قبول" });
    const user = userEvent.setup();
    await user.click(acceptButton);

    await waitFor(() => expect(respondSpy).toHaveBeenCalledWith("decision-1", "accepted"));
    expect(await screen.findByRole("button", { name: "أُنجز" })).toBeInTheDocument();
  });
});
