import { describe, expect, it } from "vitest";
import { PostgresHypothesisRepository } from "../../src/learning/PostgresHypothesisRepository";
import { DuplicateHypothesisError, InvalidHypothesisTransitionError } from "../../src/learning/errors";
import { Hypothesis } from "../../src/types";
import { createPgMemDb, DEFAULT_TEST_USER_ID, OTHER_TEST_USER_ID } from "../persistence/postgres/pgMemHarness";

function hypothesis(id: string, edgeId: string): Hypothesis {
  return {
    id: id as any,
    statement: "caffeine after 3pm reduces sleep quality",
    relatedEdgeId: edgeId as any,
    status: "forming",
    competingHypothesisId: null,
    confidence: 0.3,
    evidenceCount: 1,
  };
}

describe("PostgresHypothesisRepository (pg-mem)", () => {
  it("round-trips add/get/getByRelatedEdgeId/updateStatus", async () => {
    const db = createPgMemDb();
    const repo = new PostgresHypothesisRepository(db, DEFAULT_TEST_USER_ID);
    const h = hypothesis("11111111-1111-4111-8111-111111111114", "22222222-2222-4222-8222-222222222225");
    await repo.add(h);

    expect(await repo.get(h.id)).toEqual(h);
    expect(await repo.getByRelatedEdgeId(h.relatedEdgeId)).toEqual([h]);

    const updated = await repo.updateStatus(h.id, { status: "testing", confidence: 0.5, evidenceCount: 2 });
    expect(updated.status).toBe("testing");
  });

  it("rejects a duplicate hypothesis id", async () => {
    const db = createPgMemDb();
    const repo = new PostgresHypothesisRepository(db, DEFAULT_TEST_USER_ID);
    const h = hypothesis("33333333-3333-4333-8333-333333333336", "44444444-4444-4444-8444-444444444447");
    await repo.add(h);
    await expect(repo.add(h)).rejects.toThrow(DuplicateHypothesisError);
  });

  it("rejects an illegal status transition", async () => {
    const db = createPgMemDb();
    const repo = new PostgresHypothesisRepository(db, DEFAULT_TEST_USER_ID);
    const h = hypothesis("55555555-5555-4555-8555-555555555558", "66666666-6666-4666-8666-666666666669");
    await repo.add(h);
    await expect(
      repo.updateStatus(h.id, { status: "confirmed", confidence: 0.9, evidenceCount: 5 }),
    ).rejects.toThrow(InvalidHypothesisTransitionError);
  });

  it("isolates hypotheses by bound userId", async () => {
    const db = createPgMemDb();
    const ownerRepo = new PostgresHypothesisRepository(db, DEFAULT_TEST_USER_ID);
    const otherRepo = new PostgresHypothesisRepository(db, OTHER_TEST_USER_ID);
    const h = hypothesis("77777777-7777-4777-8777-77777777777a", "88888888-8888-4888-8888-88888888888b");
    await ownerRepo.add(h);

    expect(await otherRepo.get(h.id)).toBeUndefined();
  });
});
