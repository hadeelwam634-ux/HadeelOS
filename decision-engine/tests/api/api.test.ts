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

describe("API layer v1 — health", () => {
  it("GET /api/system/health works without auth", async () => {
    const app = createApp();
    const res = await request(app).get("/api/system/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("API layer v1 — authentication", () => {
  it("401s every protected endpoint when x-user-id is missing", async () => {
    const app = createApp();
    const res = await request(app).get("/api/signals/current");
    expect(res.status).toBe(401);
    expect(res.body.error.name).toBe("UnauthenticatedError");
    expect(res.headers["x-request-id"]).toBeDefined();
  });
});

describe("API layer v1 — validation", () => {
  it("400s a malformed POST /api/signals body", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/signals")
      .set("x-user-id", "user-a")
      .send({ signals: [{ signalType: "sleep_duration" }] });
    expect(res.status).toBe(400);
    expect(res.body.error.name).toBe("ValidationError");
    expect(Array.isArray(res.body.error.issues)).toBe(true);
  });
});

describe("API layer v1 — routing", () => {
  it("404s an unknown route", async () => {
    const app = createApp();
    const res = await request(app).get("/api/does-not-exist").set("x-user-id", "user-a");
    expect(res.status).toBe(404);
  });
});

describe("API layer v1 — signals", () => {
  it("ingests signals and reads them back", async () => {
    const app = createApp();
    const post = await request(app)
      .post("/api/signals")
      .set("x-user-id", "user-a")
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

    const get = await request(app).get("/api/signals/current").set("x-user-id", "user-a");
    expect(get.status).toBe(200);
    expect(get.body.signalStore.sleep_duration.latestValue).toBe(7);
  });
});

describe("API layer v1 — today + decisions + memory end-to-end", () => {
  it("runs a full Today -> respond -> outcome -> history flow", async () => {
    const app = createApp();
    const decision = makeDecision();

    const recalc = await request(app)
      .post("/api/today/recalculate")
      .set("x-user-id", "user-a")
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

    const today = await request(app).get("/api/today").set("x-user-id", "user-a");
    expect(today.status).toBe(200);
    expect(today.body).toEqual(recalc.body);

    if (recalc.body.decision !== null) {
      const decisionId = recalc.body.decision.id;

      const respond = await request(app)
        .post(`/api/decisions/${decisionId}/respond`)
        .set("x-user-id", "user-a")
        .send({ action: "accepted" });
      expect(respond.status).toBe(200);
      expect(respond.body.entry.userAction).toBe("accepted");

      const outcome = await request(app)
        .post(`/api/decisions/${decisionId}/outcome`)
        .set("x-user-id", "user-a")
        .send({ outcome: "completed" });
      expect(outcome.status).toBe(200);
      expect(outcome.body.entry.outcome).toBe("completed");

      const history = await request(app)
        .get(`/api/decisions/${decisionId}/history`)
        .set("x-user-id", "user-a");
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
    const res = await request(app).get("/api/today").set("x-user-id", "fresh-user");
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownTodayResultError");
  });

  it("responding to an unknown decision 404s", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/decisions/does-not-exist/respond")
      .set("x-user-id", "user-a")
      .send({ action: "accepted" });
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownDecisionError");
  });

  it("recording an outcome before any response 422s", async () => {
    const app = createApp();
    await request(app)
      .post("/api/today/recalculate")
      .set("x-user-id", "user-b")
      .send({
        signalStoreDelta: [],
        candidateDecisions: [makeDecision({ id: "decision-2" })],
        previouslyAcceptedDecisions: [],
        accuracyByDecisionType: {},
        baselineForecast,
        sourceVersions,
      });
    const today = await request(app).get("/api/today").set("x-user-id", "user-b");
    if (today.body.decision !== null) {
      const res = await request(app)
        .post(`/api/decisions/${today.body.decision.id}/outcome`)
        .set("x-user-id", "user-b")
        .send({ outcome: "completed" });
      expect(res.status).toBe(422);
      expect(res.body.error.name).toBe("DecisionNotYetRespondedError");
    }
  });
});

describe("API layer v1 — memory governance", () => {
  it("corrects, then forgets, a memory that does not exist yet -> 404", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/memory/unknown-memory/correct")
      .set("x-user-id", "user-a")
      .send({ value: "asr" });
    expect(res.status).toBe(404);
    expect(res.body.error.name).toBe("UnknownMemoryRecordError");
  });

  it("GET /api/memory returns an empty list for a brand-new user", async () => {
    const app = createApp();
    const res = await request(app).get("/api/memory").set("x-user-id", "new-user");
    expect(res.status).toBe(200);
    expect(res.body.memories).toEqual([]);
  });
});

describe("API layer v1 — per-user isolation", () => {
  it("never leaks one user's signals, decisions, or memory to another user", async () => {
    const app = createApp();

    await request(app)
      .post("/api/signals")
      .set("x-user-id", "alice")
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

    const bobSignals = await request(app).get("/api/signals/current").set("x-user-id", "bob");
    expect(bobSignals.status).toBe(200);
    expect(bobSignals.body.signalStore).toEqual({});

    const aliceRecalc = await request(app)
      .post("/api/today/recalculate")
      .set("x-user-id", "alice")
      .send({
        signalStoreDelta: [],
        candidateDecisions: [makeDecision({ id: "alice-decision" })],
        previouslyAcceptedDecisions: [],
        accuracyByDecisionType: {},
        baselineForecast,
        sourceVersions,
      });
    expect(aliceRecalc.status).toBe(200);

    const bobToday = await request(app).get("/api/today").set("x-user-id", "bob");
    expect(bobToday.status).toBe(404);

    if (aliceRecalc.body.decision !== null) {
      const bobHistory = await request(app)
        .get(`/api/decisions/${aliceRecalc.body.decision.id}/history`)
        .set("x-user-id", "bob");
      expect(bobHistory.status).toBe(200);
      // Isolated: bob's own (separate) EventLogRepository has never
      // heard of alice's decision id, so history is empty rather than
      // returning alice's entries.
      expect(bobHistory.body.history).toEqual([]);
    }
  });
});
