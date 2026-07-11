import { describe, it, expect } from "vitest";
import { HypothesisService } from "../../src/learning/HypothesisService";
import { InMemoryHypothesisRepository } from "../../src/learning/InMemoryHypothesisRepository";
import { IdGenerator } from "../../src/application/types";
import { UUID } from "../../src/types";
import { UnknownHypothesisError } from "../../src/learning/errors";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `h-${this.counter}`;
  }
}

function makeService() {
  const repository = new InMemoryHypothesisRepository();
  const service = new HypothesisService(repository, new FakeIdGenerator());
  return { service, repository };
}

describe("HypothesisService", () => {
  it("formHypothesis assigns a deterministic id and starts at status forming with zero evidence", async () => {
    const { service, repository } = makeService();
    const hypothesis = await service.formHypothesis({ statement: "X causes Y", relatedEdgeId: "e1" });

    expect(hypothesis).toEqual({
      id: "h-1",
      statement: "X causes Y",
      relatedEdgeId: "e1",
      status: "forming",
      competingHypothesisId: null,
      confidence: 0,
      evidenceCount: 0,
    });
    expect(await repository.get("h-1")).toEqual(hypothesis);
  });

  it("formHypothesis honors an explicit competingHypothesisId", async () => {
    const { service } = makeService();
    const hypothesis = await service.formHypothesis({
      statement: "X causes Y",
      relatedEdgeId: "e1",
      competingHypothesisId: "h-rival",
    });
    expect(hypothesis.competingHypothesisId).toBe("h-rival");
  });

  it("beginTesting moves forming -> testing, preserving confidence/evidenceCount", async () => {
    const { service } = makeService();
    const hypothesis = await service.formHypothesis({ statement: "X causes Y", relatedEdgeId: "e1" });
    const updated = await service.beginTesting(hypothesis.id);
    expect(updated.status).toBe("testing");
  });

  it("markUnknownCompeting moves forming -> unknown_competing and records the competing id", async () => {
    const { service } = makeService();
    const hypothesis = await service.formHypothesis({ statement: "X causes Y", relatedEdgeId: "e1" });
    const updated = await service.markUnknownCompeting(hypothesis.id, "h-rival");
    expect(updated.status).toBe("unknown_competing");
    expect(updated.competingHypothesisId).toBe("h-rival");
  });

  it("confirm and reject move testing to the corresponding terminal status", async () => {
    const { service } = makeService();
    const a = await service.formHypothesis({ statement: "A", relatedEdgeId: "e1" });
    await service.beginTesting(a.id);
    const confirmed = await service.confirm(a.id, 0.8, 3);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.confidence).toBe(0.8);

    const b = await service.formHypothesis({ statement: "B", relatedEdgeId: "e1" });
    await service.beginTesting(b.id);
    const rejected = await service.reject(b.id, 0.1, 2);
    expect(rejected.status).toBe("rejected");
  });

  it("beginTesting throws UnknownHypothesisError for a hypothesis that does not exist", async () => {
    const { service } = makeService();
    await expect(service.beginTesting("missing")).rejects.toThrow(UnknownHypothesisError);
  });

  it("getByRelatedEdgeId delegates to the repository", async () => {
    const { service } = makeService();
    await service.formHypothesis({ statement: "A", relatedEdgeId: "e1" });
    await service.formHypothesis({ statement: "B", relatedEdgeId: "e2" });
    const forE1 = await service.getByRelatedEdgeId("e1");
    expect(forE1).toHaveLength(1);
    expect(forE1[0].statement).toBe("A");
  });
});
