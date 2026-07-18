import { describe, expect, it } from "vitest";
import { PostgresKnowledgeGraphRepository } from "../../src/knowledge-graph/PostgresKnowledgeGraphRepository";
import {
  DuplicateNodeError,
  SelfEdgeNotAllowedError,
  UnknownNodeReferenceError,
} from "../../src/knowledge-graph/errors";
import { KGEdge, KGNode } from "../../src/types";
import { createPgMemDb, DEFAULT_TEST_USER_ID, OTHER_TEST_USER_ID } from "../persistence/postgres/pgMemHarness";

function node(id: string, domain: string): KGNode {
  return { id: id as any, domain, createdAt: "2026-07-01T00:00:00.000Z" };
}

describe("PostgresKnowledgeGraphRepository (pg-mem)", () => {
  it("round-trips nodes and edges, and updates maturity with a history entry", async () => {
    const db = createPgMemDb();
    const repo = new PostgresKnowledgeGraphRepository(db, DEFAULT_TEST_USER_ID);
    const a = node("11111111-1111-4111-8111-111111111113", "sleep");
    const b = node("22222222-2222-4222-8222-222222222224", "mood");
    await repo.addNode(a);
    await repo.addNode(b);
    expect(await repo.getNodesByDomain("sleep")).toEqual([a]);

    const edge: KGEdge = {
      id: "33333333-3333-4333-8333-333333333335" as any,
      fromNodeId: a.id,
      toNodeId: b.id,
      recordType: "Observation",
      causalMaturity: "correlated",
      confidence: 0.4,
      evidenceCount: 2,
      directionBasis: "temporal_precedence",
      lastReinforcedAt: "2026-07-01T00:00:00.000Z",
    };
    await repo.addEdge(edge);
    expect(await repo.findEdgesFrom(a.id)).toEqual([edge]);
    expect(await repo.findEdgesBetween(a.id, b.id)).toEqual([edge]);

    const updated = await repo.updateEdgeMaturity(edge.id, "suspected_causal", 0.6, 3, {
      recordId: "44444444-4444-4444-8444-444444444446" as any,
      timestamp: "2026-07-02T00:00:00.000Z",
    });
    expect(updated.causalMaturity).toBe("suspected_causal");

    const history = await repo.getMaturityHistory(edge.id);
    expect(history).toHaveLength(1);
    expect(history[0].kind).toBe("advance_one_step");
  });

  it("rejects a duplicate node id", async () => {
    const db = createPgMemDb();
    const repo = new PostgresKnowledgeGraphRepository(db, DEFAULT_TEST_USER_ID);
    const a = node("55555555-5555-4555-8555-555555555557", "sleep");
    await repo.addNode(a);
    await expect(repo.addNode(a)).rejects.toThrow(DuplicateNodeError);
  });

  it("rejects an edge referencing an unknown node", async () => {
    const db = createPgMemDb();
    const repo = new PostgresKnowledgeGraphRepository(db, DEFAULT_TEST_USER_ID);
    const a = node("66666666-6666-4666-8666-666666666668", "sleep");
    await repo.addNode(a);
    const edge: KGEdge = {
      id: "77777777-7777-4777-8777-777777777779" as any,
      fromNodeId: a.id,
      toNodeId: "88888888-8888-4888-8888-888888888880" as any,
      recordType: "Observation",
      causalMaturity: "correlated",
      confidence: 0.4,
      evidenceCount: 2,
      directionBasis: "temporal_precedence",
      lastReinforcedAt: "2026-07-01T00:00:00.000Z",
    };
    await expect(repo.addEdge(edge)).rejects.toThrow(UnknownNodeReferenceError);
  });

  it("rejects a self-edge unless explicitly allowed", async () => {
    const db = createPgMemDb();
    const repo = new PostgresKnowledgeGraphRepository(db, DEFAULT_TEST_USER_ID);
    const a = node("99999999-9999-4999-8999-999999999991", "sleep");
    await repo.addNode(a);
    const edge: KGEdge = {
      id: "aaaaaaa1-1111-4111-8111-111111111111" as any,
      fromNodeId: a.id,
      toNodeId: a.id,
      recordType: "Observation",
      causalMaturity: "correlated",
      confidence: 0.4,
      evidenceCount: 2,
      directionBasis: "temporal_precedence",
      lastReinforcedAt: "2026-07-01T00:00:00.000Z",
    };
    await expect(repo.addEdge(edge)).rejects.toThrow(SelfEdgeNotAllowedError);
    await expect(repo.addEdge(edge, { allowSelfEdge: true })).resolves.toBeUndefined();
  });

  it("isolates nodes/edges by bound userId", async () => {
    const db = createPgMemDb();
    const ownerRepo = new PostgresKnowledgeGraphRepository(db, DEFAULT_TEST_USER_ID);
    const otherRepo = new PostgresKnowledgeGraphRepository(db, OTHER_TEST_USER_ID);
    const a = node("bbbbbbb1-1111-4111-8111-111111111111", "sleep");
    await ownerRepo.addNode(a);

    expect(await otherRepo.getNode(a.id)).toBeUndefined();
    expect(await otherRepo.getNodesByDomain("sleep")).toEqual([]);
    // A node from a different tenant must be treated as unknown even
    // when adding an edge — otherwise one user could link a node they
    // don't own into their own graph.
    const edge: KGEdge = {
      id: "ccccccc1-1111-4111-8111-111111111111" as any,
      fromNodeId: a.id,
      toNodeId: a.id,
      recordType: "Observation",
      causalMaturity: "correlated",
      confidence: 0.4,
      evidenceCount: 2,
      directionBasis: "temporal_precedence",
      lastReinforcedAt: "2026-07-01T00:00:00.000Z",
    };
    await expect(otherRepo.addEdge(edge, { allowSelfEdge: true })).rejects.toThrow(UnknownNodeReferenceError);
  });
});
