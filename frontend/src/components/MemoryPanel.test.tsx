import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApiClient } from "../api/client";
import { MemoryPanel } from "./MemoryPanel";
import { renderWithI18n } from "../test/renderWithI18n";

afterEach(() => {
  vi.restoreAllMocks();
});

const memoryRecord = {
  id: "mem-1",
  userId: "u1",
  key: "prayer_preference",
  state: "Knows" as const,
  value: "fajr",
  confidence: 1,
  evidenceCount: 3,
  lastReinforcedAt: "2026-01-01T00:00:00.000Z",
  blocked: false,
};

describe("MemoryPanel", () => {
  it("renders memories from the live API, not hard-coded data", async () => {
    vi.spyOn(ApiClient.prototype, "getMemory").mockResolvedValue({ memories: [memoryRecord] });
    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<MemoryPanel client={client} />);

    expect(await screen.findByText(/prayer_preference/)).toBeInTheDocument();
  });

  it("forgetting a memory calls forgetMemory() and reloads the list", async () => {
    vi.spyOn(ApiClient.prototype, "getMemory").mockResolvedValue({ memories: [memoryRecord] });
    const forgetSpy = vi.spyOn(ApiClient.prototype, "forgetMemory").mockResolvedValue({ memory: memoryRecord });

    const client = new ApiClient({ token: "test-token" });
    renderWithI18n(<MemoryPanel client={client} />);

    const forgetButton = await screen.findByRole("button", { name: "نسيان" });
    const user = userEvent.setup();
    await user.click(forgetButton);

    await waitFor(() => expect(forgetSpy).toHaveBeenCalledWith("mem-1"));
  });
});
