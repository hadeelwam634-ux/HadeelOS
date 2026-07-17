import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/api/server";
import { Decision } from "../../src/types";

function makeDecision(overrides: Partial<Decision> = {}): Decision {
  return {
    id: overrides.id ?? "decision-1",
    type: "quran_timing",
    proposedAction: "read after fajr",
    confidence: 0.5,
    confidenceQualifier: "moderate",
    alternatives: [],
    state: "Proposed",
    createdAt: "2026-01-01T00:00:00.000Z",
    revisedAt: null,
    revisionReason: null,
    supersedesDecisionId: null,
    ...overrides,
  };
}

const baselineForecast = { completion: 70, capacity: 70 };
const sourceVersions = { signalsUpdatedAt: null, eventLogCursor: null, graphVersion: null };

/**
 * Registers and logs in a brand-new user (real auth, PR #12 — no more
 * trusting an `x-user-id` header) and returns the Authorization header
 * to attach to subsequent requests acting as that same user. Call this
 * once per logical user per test and reuse the returned header, exactly
 * like the old tests reused a literal "user-a" string.
 */
let userCounter = 0;
async function authHeaderFor(
  app: ReturnType<typeof createApp>,
  label: string,
): Promise<{ Authorization: string }> {
  const email = `${label}-${userCounter++}@example.test`;
  const password = "Sup3rSecret!42";
  await request(app).post("/api/auth/register").send({ email, password });
  const login = await request(app).post("/api/auth/login").send({ email, password });
  return { Authorization: `Bearer ${login.body.token}` };
}

describe("API layer v1 — health", () => {
  it("GET /api/system/health works without auth", async () => {
    const app = createApp();
    const res = await request(app).get("/api/system/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptimeSeconds).toBe("number");
  });
});

describe("API layer v1 — authentication", () => {
  it("401s every protected endpoint when no bearer token is presented", async () => {
    const app = createApp();
    const res = await request(app).get("/api/signals/current");
    expect(res.status).toBe(401);
    expect(res.body.error.name).toBe("UnauthenticatedError");
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("401s a malformed or unknown bearer token", async () => {
    const app = createApp();
    const res = await request(app)
      .get("/api/signals/current")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("registers a user, logs in, and reaches a protected endpoint with the returned token", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "alice");
    const res = await request(app).get("/api/signals/current").set(auth);
    expect(res.status).toBe(200);
  });

  it("409s registering the same email twice", async () => {
    const app = createApp();
    const email = "dup@example.test";
    const password = "Sup3rSecret!42";
    const first = await request(app).post("/api/auth/register").send({ email, password });
    expect(first.status).toBe(201);
    const second = await request(app).post("/api/auth/register").send({ email, password });
    expect(second.status).toBe(409);
    expect(second.body.error.name).toBe("DuplicateEmailError");
  });

  it("401s login with a wrong password", async () => {
    const app = createApp();
    const email = "wrongpw@example.test";
    const password = "Sup3rSecret!42";
    await request(app).post("/api/auth/register").send({ email, password });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email, password: "totallyWrong123" });
    expect(res.status).toBe(401);
    expect(res.body.error.name).toBe("InvalidCredentialsError");
  });

  it("400s registering with a password that fails the strength policy", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/auth/register")
      .send({ email: "weak@example.test", password: "short1" });
    expect(res.status).toBe(400);
    expect(res.body.error.name).toBe("ValidationError");
  });

  it("logout revokes the token so it no longer authenticates", async () => {
    const app = createApp();
    const email = "logout@example.test";
    const password = "Sup3rSecret!42";
    await request(app).post("/api/auth/register").send({ email, password });
    const login = await request(app).post("/api/auth/login").send({ email, password });
    const token = login.body.token;

    const before = await request(app)
      .get("/api/signals/current")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);

    await request(app).post("/api/auth/logout").send({ token });

    const after = await request(app)
      .get("/api/signals/current")
      .set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});

describe("API layer v1 — validation", () => {
  it("400s a malformed POST /api/signals body", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-a");
    const res = await request(app)
      .post("/api/signals")
      .set(auth)
      .send({ signals: [{ signalType: "sleep_duration" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.name).toBe("ValidationError");
    expect(Array.isArray(res.body.error.issues)).toBe(true);
  });
});

describe("API layer v1 — routing", () => {
  it("404s an unknown route", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-a");
    const res = await request(app).get("/api/does-not-exist").set(auth);
    expect(res.status).toBe(404);
  });
});

describe("API layer v1 — signals", () => {
  it("ingests signals and reads them back", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-a");
    const post = await request(app)
      .post("/api/signals")
      .set(auth)
      .send({
        signals: [
          {
            signalType: "sleep_duration",
            latestValue: 7,
            latestTimestamp: "2026-01-01T00:00:00.000Z",
            reliabilityScore: 0.9,
            syncConsistencyDays: 5,
          },
        ],
      });
    expect(post.status).toBe(200);
    expect(post.body.signalStore.sleep_duration.latestValue).toBe(7);

    const get = await request(app).get("/api/signals/current").set(auth);
    expect(get.status).toBe(200);
    expect(get.body.signalStore.sleep_duration.latestValue).toBe(7);
  });
});

describe("API layer v1 — today + decisions + memory end-to-end", () => {
  it("runs a full Today -> respond -> outcome -> history flow", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-a");
    const decision = makeDecision();

    const recalc = await request(app)
      .post("/api/today/recalculate")
      .set(auth)
      .send({
        signalStoreDelta: [],
        candidateDecisions: [decision],
        previouslyAcceptedDecisions: [],
        accuracyByDecisionType: {},
        baselineForecast,
        sourceVersions,
      });
    expect(recalc.status).toBe(200);
    expect(recalc.body.context).toBeDefined();

    const today = await request(app).get("/api/today").set(auth);
    expect(today.status).toBe(200);
    expect(today.body).toEqual(recalc.body);

    if (recalc.body.decision !== null) {
      const decisionId = recalc.body.decision.id;

      const respond = await request(app)
        .post(`/api/decisions/${decisionId}/respond`)
        .set(auth)
        .send({ action: "accepted" });
      expect(respond.status).toBe(200);
      expect(respond.body.entry.userAction).toBe("accepted");

      const outcome = await request(app)
        .post(`/api/decisions/${decisionId}/outcome`)
        .set(auth)
        .send({ outcome: "completed" });
      expect(outcome.status).toBe(200);
      expect(outcome.body.entry.outcome).toBe("completed");

      const history = await request(app)
        .get(`/api/decisions/${decisionId}/history`)
        .set(auth);
      expect(history.status).toBe(200);
      expect(history.body.history.length).toBe(3);
      expect(history.body.history.map((e: { userAction: string }) => e.userAction)).toEqual([
        "proposed",
        "accepted",
        "accepted",
      ]);
    }
  });

  it("GET /api/today 404s before any recalculate has run for this user", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "fresh-user");
    const res = await request(app).get("/api/today").set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownTodayResultError");
  });

  it("responding to an unknown decision 404s", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-a");
    const res = await request(app)
      .post("/api/decisions/does-not-exist/respond")
      .set(auth)
      .send({ action: "accepted" });
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownDecisionError");
  });

  it("recording an outcome before any response 422s", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-b");
    await request(app)
      .post("/api/today/recalculate")
      .set(auth)
      .send({
        signalStoreDelta: [],
        candidateDecisions: [makeDecision({ id: "decision-2" })],
        previouslyAcceptedDecisions: [],
        accuracyByDecisionType: {},
        baselineForecast,
        sourceVersions,
      });
    const today = await request(app).get("/api/today").set(auth);
    if (today.body.decision !== null) {
      const res = await request(app)
        .post(`/api/decisions/${today.body.decision.id}/outcome`)
        .set(auth)
        .send({ outcome: "completed" });
      expect(res.status).toBe(422);
      expect(res.body.error.name).toBe("DecisionNotYetRespondedError");
    }
  });
});

describe("API layer v1 — memory governance", () => {
  it("corrects, then forgets, a memory that does not exist yet -> 404", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "user-a");
    const res = await request(app)
      .post("/api/memory/unknown-memory/correct")
      .set(auth)
      .send({ value: "asr" });
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownMemoryRecordError");
  });

  it("GET /api/memory returns an empty list for a brand-new user", async () => {
    const app = createApp();
    const auth = await authHeaderFor(app, "new-user");
    const res = await request(app).get("/api/memory").set(auth);
    expect(res.status).toBe(200);
    expect(res.body.memories).toEqual([]);
  });
});

describe("API layer v1 — per-user isolation", () => {
  it("never leaks one user's signals, decisions, or memory to another user", async () => {
    const app = createApp();
    const alice = await authHeaderFor(app, "alice");
    const bob = await authHeaderFor(app, "bob");

    await request(app)
      .post("/api/signals")
      .set(alice)
      .send({
        signals: [
          {
            signalType: "mood_score",
            latestValue: 9,
            latestTimestamp: "2026-01-01T00:00:00.000Z",
            reliabilityScore: 1,
            syncConsistencyDays: 1,
          },
        ],
      });

    const bobSignals = await request(app).get("/api/signals/current").set(bob);
    expect(bobSignals.status).toBe(200);
    expect(bobSignals.body.signalStore).toEqual({});

    const aliceRecalc = await request(app)
      .post("/api/today/recalculate")
      .set(alice)
      .send({
        signalStoreDelta: [],
        candidateDecisions: [makeDecision({ id: "alice-decision" })],
        previouslyAcceptedDecisions: [],
        accuracyByDecisionType: {},
        baselineForecast,
        sourceVersions,
      });
    expect(aliceRecalc.status).toBe(200);

    const bobToday = await request(app).get("/api/today").set(bob);
    expect(bobToday.status).toBe(404);

    if (aliceRecalc.body.decision !== null) {
      const bobHistory = await request(app)
        .get(`/api/decisions/${aliceRecalc.body.decision.id}/history`)
        .set(bob);
      expect(bobHistory.status).toBe(200);
      // Isolated: bob's own (separate) EventLogRepository has never
      // heard of alice's decision id, so history is empty rather than
      // returning alice's entries.
      expect(bobHistory.body.history).toEqual([]);
    }
  });
});
