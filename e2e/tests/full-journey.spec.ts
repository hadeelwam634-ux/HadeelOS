import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { spawnBackend, killBackend } from "../backend-control";
import type { ChildProcess } from "node:child_process";

/**
 * One continuous, ordered user journey covering every flow MVP
 * Hardening requires E2E coverage for:
 *
 *   registration -> login session is usable -> Today Cockpit renders
 *   -> connect Calendar (mock provider) -> connect Gmail (mock
 *   provider) -> kill + restart the real backend process against the
 *   SAME Postgres database -> reload the page and confirm the session
 *   AND both connections survived the restart -> log out.
 *
 * Deliberately one serial test rather than several independent ones:
 * the restart step is disruptive to the shared backend process (see
 * backend-control.ts), so it must run after every other flow that
 * depends on that backend being continuously up, and log back out at
 * the end so this suite leaves no dangling session.
 *
 * Also runs an axe-core accessibility scan against both the pre-login
 * screen and the authenticated Today Cockpit screen (MVP Hardening
 * requirement #9 — "basic accessibility check on the main screens").
 */
test.describe.serial("HadeelOS full user journey (MVP Hardening E2E)", () => {
  const email = `e2e-${Date.now()}@example.test`;
  const password = "Sup3rSecret!42";

  test("registration renders an accessible auth screen and creates a session", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "HadeelOS" })).toBeVisible();

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);

    // Default language is Arabic (RTL) — flip to the switch-to-register
    // control regardless of language by relying on the <label for>
    // wiring (id-based) rather than translated text.
    await page.locator("#auth-email").fill(email);
    await page.locator("#auth-password").fill(password);
    await page.locator("form.auth-form button[type=submit]").click();

    // A successful register/login leaves the auth form and shows the
    // authenticated shell (top bar + Today Cockpit heading).
    await expect(page.locator(".top-bar")).toBeVisible();
    await expect(page.locator("main#main-content h1")).toBeVisible();

    const token = await page.evaluate(() => window.localStorage.getItem("hadeelos.sessionToken"));
    expect(token).toBeTruthy();
  });

  test("Today Cockpit loads for the authenticated user", async ({ page }) => {
    await page.goto("/");
    // Already authenticated from the previous test (same storage state
    // within this worker/browser context) — should land directly on
    // the cockpit, not the auth screen.
    await expect(page.locator(".top-bar")).toBeVisible();
    await expect(page.locator("main#main-content h1")).toBeVisible();

    const a11y = await new AxeBuilder({ page }).analyze();
    expect(a11y.violations, JSON.stringify(a11y.violations, null, 2)).toEqual([]);
  });

  test("connects Calendar and Gmail via the mock provider", async ({ page }) => {
    await page.goto("/");
    const rows = page.locator(".connector-row");
    await expect(rows).toHaveCount(2);

    // Row 0: Calendar, Row 1: Gmail (see ConnectorsPanel.tsx order).
    const calendarRow = rows.nth(0);
    const gmailRow = rows.nth(1);

    await calendarRow.getByRole("button").click();
    await expect(calendarRow.getByRole("button")).toHaveText(/disconnect|فصل/i, { timeout: 10_000 });

    await gmailRow.getByRole("button").click();
    await expect(gmailRow.getByRole("button")).toHaveText(/disconnect|فصل/i, { timeout: 10_000 });
  });

  test("session and connections survive a real backend restart", async ({ page }) => {
    await page.goto("/");
    // Confirm pre-restart state: both connectors show "connected", not
    // "connect" — i.e. this reload already round-tripped through the
    // backend once since the previous test.
    const rows = page.locator(".connector-row");
    await expect(rows.nth(0).getByRole("button")).toHaveText(/disconnect|فصل/i);
    await expect(rows.nth(1).getByRole("button")).toHaveText(/disconnect|فصل/i);

    const tokenBeforeRestart = await page.evaluate(() => window.localStorage.getItem("hadeelos.sessionToken"));
    expect(tokenBeforeRestart).toBeTruthy();

    // Real process kill + real process restart, same DATABASE_URL —
    // no in-memory shortcut. The backend spawned here is a brand-new
    // OS process; nothing about this session/connection data could
    // have survived unless it was actually written to Postgres.
    let backend: ChildProcess | null = null;
    await test.step("restart backend process", async () => {
      // The backend spawned by global-setup.ts is what's currently
      // serving — locate and kill it isn't directly possible from this
      // process handle-free context, so instead we rely on the fact
      // that spawning a NEW backend on the same PORT will fail to bind
      // unless the old one is gone. To keep this self-contained and
      // robust, we ask the running backend to exit via its own
      // graceful-shutdown path is not exposed over HTTP by design (no
      // admin/shutdown endpoint — a deliberate security choice, see
      // README "Security"), so we instead shell out to find and kill
      // the process bound to BACKEND_PORT directly.
      const { execSync } = await import("node:child_process");
      try {
        const pid = execSync(`lsof -t -i:3900`).toString().trim().split("\n")[0];
        if (pid) process.kill(Number(pid), "SIGTERM");
      } catch {
        // lsof unavailable or nothing bound — fall through and let
        // spawnBackend's health check fail loudly if that's wrong.
      }
      await new Promise((r) => setTimeout(r, 1000));
      backend = await spawnBackend();
    });

    await page.reload();
    await expect(page.locator(".top-bar")).toBeVisible({ timeout: 15_000 });

    const tokenAfterRestart = await page.evaluate(() => window.localStorage.getItem("hadeelos.sessionToken"));
    expect(tokenAfterRestart).toBe(tokenBeforeRestart);

    const rowsAfter = page.locator(".connector-row");
    await expect(rowsAfter.nth(0).getByRole("button")).toHaveText(/disconnect|فصل/i, { timeout: 10_000 });
    await expect(rowsAfter.nth(1).getByRole("button")).toHaveText(/disconnect|فصل/i, { timeout: 10_000 });

    // Leave the backend running for teardown (global-setup's returned
    // teardown function kills whatever is bound to BACKEND_PORT when
    // the suite ends — a second SIGTERM on an already-exited process
    // from a prior handle is a safe no-op).
    void backend;
  });

  test("logout clears the session and returns to the auth screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".top-bar")).toBeVisible();

    await page.locator("button.logout-button").click();

    await expect(page.locator("#auth-email")).toBeVisible();
    const token = await page.evaluate(() => window.localStorage.getItem("hadeelos.sessionToken"));
    expect(token).toBeNull();
  });
});
