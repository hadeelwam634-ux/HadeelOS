import { describe, it, expect } from "vitest";
import { KnowledgeGraphService } from "../../src/knowledge-graph/KnowledgeGraphService";
import { InMemoryKnowledgeGraphRepository } from "../../src/knowledge-graph/InMemoryKnowledgeGraphRepository";
import { Clock, IdGenerator } from "../../src/application/types";
import { UUID } from "../../src/types";

class FakeIdGenerator implements IdGenerator {
  private counter = 0;
  next(): UUID {
    this.counter += 1;
    return `kg-${this.counter}`;
  }
}

class FakeClock implements Clock {
  now(): string {
    return "2026-07-11T06:00:00Z";
  }
}

function makeService() {
  const repository = new InMemoryKnowledgeGraphRepository();
  const service = new KnowledgeGraphService(repository, new FakeIdGenerator(), new FakeClock());
  return { service, repository };
}

describe("KnowledgeGraphService", () => {
  it("recordNode assigns a deterministic id and timestamp and persists the node", async () => {
    const { service, repository } = makeService();
    const node = await service.recordNode("sleep");

    expect(node).toEqual({ id: "kg-1", domain: "sleep", createdAt: "2026-07-11T06:00:00Z" });
    expect(await repository.getNode("kg-1")).toEqual(node);
  });

  it("recordEdge assigns a deterministic id, defaults maturity/confidence/evidence, and persists the edge", async () => {
    const { service, repository } = makeService();
    const a = await service.recordNode("sleep");
    const b = await service.recordNode("mood");

    const edge = await service.recordEdge({
      fromNodeId: a.id,
      toNodeId: b.id,
      recordType: "Observation",
      directionBasis: "temporal_precedence",
    });

    expect(edge).toEqual({
      id: "kg-3",
      fromNodeId: a.id,
      toNodeId: b.id,
      recordType: "Observation",
      causalMaturity: "correlated",
      confidence: 0,
      evidenceCount: 0,
      directionBasis: "temporal_precedence",
      lastReinforcedAt: "2026-07-11T06:00:00Z",
    });
    expect(await repository.getEdge("kg-3")).toEqual(edge);
  });

  it("recordEdge honors explicit initial maturity/confidence/evidence", async () => {
    const { service } = makeService();
    const a = await service.recordNode("sleep");
    const b = await service.recordNode("mood");

    const edge = await service.recordEdge({
      fromNodeId: a.id,
      toNodeId: b.id,
      recordType: "Hypothesis",
      directionBasis: "experiment",
      initialMaturity: "suspected_causal",
      initialConfidence: 0.6,
      initialEvidenceCount: 2,
    });

    expect(edge.causalMaturity).toBe("suspected_causal");
    expect(edge.confidence).toBe(0.6);
    expect(edge.evidenceCount).toBe(2);
  });

  it("reinforceEdge stamps the update with the injected clock's time", async () => {
    const { service, repository } = makeService();
    const a = await service.recordNode("sleep");
    const b = await service.recordNode("mood");
    const edge = await service.recordEdge({
      fromNodeId: a.id,
      toNodeId: b.id,
      recordType: "Observation",
      directionBasis: "temporal_precedence",
    });

    const reinforced = await service.reinforceEdge(edge.id, "suspected_causal", 0.7, 5);

    expect(reinforced.lastReinforcedAt).toBe("2026-07-11T06:00:00Z");
    expect((await repository.getEdge(edge.id))?.causalMaturity).toBe("suspected_causal");
  });

  it("recordEdge propagates AddEdgeOptions (e.g. allowSelfEdge) to the repository", async () => {
    const { service } = makeService();
    const a = await service.recordNode("sleep");

    const edge = await service.recordEdge(
      {
        fromNodeId: a.id,
        toNodeId: a.id,
        recordType: "Observation",
        directionBasis: "temporal_precedence",
      },
      { allowSelfEdge: true }
    );

    expect(edge.fromNodeId).toBe(edge.toNodeId);
  });
});
