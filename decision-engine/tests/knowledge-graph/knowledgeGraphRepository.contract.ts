import { describe, it, expect } from "vitest";
import { KGEdge, KGNode } from "../../src/types";
import { KnowledgeGraphRepository } from "../../src/knowledge-graph/KnowledgeGraphRepository";
import {
  DuplicateEdgeError,
  DuplicateNodeError,
  InvalidConfidenceError,
  InvalidEvidenceCountError,
  InvalidMaturityTransitionError,
  SelfEdgeNotAllowedError,
  UnknownEdgeError,
  UnknownNodeReferenceError,
} from "../../src/knowledge-graph/errors";

function makeNode(overrides: Partial<KGNode> = {}): KGNode {
  return {
    id: "n1",
    domain: "sleep",
    createdAt: "2026-07-10T06:00:00Z",
    ...overrides,
  };
}

function makeEdge(overrides: Partial<KGEdge> = {}): KGEdge {
  return {
    id: "e1",
    fromNodeId: "n1",
    toNodeId: "n2",
    recordType: "Observation",
    causalMaturity: "correlated",
    confidence: 0.4,
    evidenceCount: 1,
    directionBasis: "temporal_precedence",
    lastReinforcedAt: "2026-07-10T06:00:00Z",
    ...overrides,
  };
}

/**
 * Runs the same behavioral contract against any KnowledgeGraphRepository
 * implementation. A future PostgresKnowledgeGraphRepository test file
 * should import and call this with its own factory — if it passes, the
 * implementation is a verified drop-in replacement for the in-memory one.
 */
export function runKnowledgeGraphRepositoryContractTests(
  makeRepo: () => KnowledgeGraphRepository
) {
  describe("KnowledgeGraphRepository contract", () => {
    describe("nodes", () => {
      it("returns undefined for a node that was never added", async () => {
        const repo = makeRepo();
        expect(await repo.getNode("missing")).toBeUndefined();
      });

      it("adds a node retrievable via getNode", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode());
        expect(await repo.getNode("n1")).toEqual(makeNode());
      });

      it("rejects a duplicate node id", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode());
        await expect(repo.addNode(makeNode())).rejects.toThrow(DuplicateNodeError);
      });

      it("getNodesByDomain filters by domain and preserves insertion order", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ id: "n1", domain: "sleep" }));
        await repo.addNode(makeNode({ id: "n2", domain: "mood" }));
        await repo.addNode(makeNode({ id: "n3", domain: "sleep" }));

        const sleepNodes = await repo.getNodesByDomain("sleep");
        expect(sleepNodes.map((n) => n.id)).toEqual(["n1", "n3"]);
      });

      it("getNodesByDomain returns an empty array for an unknown domain", async () => {
        const repo = makeRepo();
        expect(await repo.getNodesByDomain("unknown")).toEqual([]);
      });

      it("mutating the object passed to addNode() does not affect the stored node", async () => {
        const repo = makeRepo();
        const original = makeNode({ domain: "sleep" });
        await repo.addNode(original);
        original.domain = "mutated";
        expect((await repo.getNode("n1"))?.domain).toBe("sleep");
      });

      it("mutating an object returned from getNode() or getNodesByDomain() does not affect the stored node", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ domain: "sleep" }));

        const fetched = await repo.getNode("n1");
        if (fetched) fetched.domain = "mutated";

        const [fromDomainQuery] = await repo.getNodesByDomain("sleep");
        fromDomainQuery.domain = "mutated-again";

        expect((await repo.getNode("n1"))?.domain).toBe("sleep");
      });
    });

    describe("edges", () => {
      async function seedTwoNodes(repo: KnowledgeGraphRepository) {
        await repo.addNode(makeNode({ id: "n1" }));
        await repo.addNode(makeNode({ id: "n2" }));
      }

      it("returns undefined for an edge that was never added", async () => {
        const repo = makeRepo();
        expect(await repo.getEdge("missing")).toBeUndefined();
      });

      it("adds an edge retrievable via getEdge", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        await repo.addEdge(makeEdge());
        expect(await repo.getEdge("e1")).toEqual(makeEdge());
      });

      it("rejects a duplicate edge id", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        await repo.addEdge(makeEdge());
        await expect(repo.addEdge(makeEdge())).rejects.toThrow(DuplicateEdgeError);
      });

      it("rejects an edge whose fromNodeId does not exist", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ id: "n2" }));
        await expect(
          repo.addEdge(makeEdge({ fromNodeId: "missing-from" }))
        ).rejects.toThrow(UnknownNodeReferenceError);
      });

      it("rejects an edge whose toNodeId does not exist", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ id: "n1" }));
        await expect(
          repo.addEdge(makeEdge({ toNodeId: "missing-to" }))
        ).rejects.toThrow(UnknownNodeReferenceError);
      });

      it("rejects confidence below 0", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        await expect(repo.addEdge(makeEdge({ confidence: -0.1 }))).rejects.toThrow(
          InvalidConfidenceError
        );
      });

      it("rejects confidence above 1", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        await expect(repo.addEdge(makeEdge({ confidence: 1.1 }))).rejects.toThrow(
          InvalidConfidenceError
        );
      });

      it("rejects a negative evidenceCount", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        await expect(repo.addEdge(makeEdge({ evidenceCount: -1 }))).rejects.toThrow(
          InvalidEvidenceCountError
        );
      });

      it("rejects a self-edge by default", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ id: "n1" }));
        await expect(
          repo.addEdge(makeEdge({ fromNodeId: "n1", toNodeId: "n1" }))
        ).rejects.toThrow(SelfEdgeNotAllowedError);
      });

      it("allows a self-edge when allowSelfEdge is explicitly true", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ id: "n1" }));
        await repo.addEdge(makeEdge({ fromNodeId: "n1", toNodeId: "n1" }), {
          allowSelfEdge: true,
        });
        expect(await repo.getEdge("e1")).toMatchObject({ fromNodeId: "n1", toNodeId: "n1" });
      });

      it("findEdgesFrom/To/Between preserve insertion order and filter correctly", async () => {
        const repo = makeRepo();
        await repo.addNode(makeNode({ id: "n1" }));
        await repo.addNode(makeNode({ id: "n2" }));
        await repo.addNode(makeNode({ id: "n3" }));
        await repo.addEdge(makeEdge({ id: "e1", fromNodeId: "n1", toNodeId: "n2" }));
        await repo.addEdge(makeEdge({ id: "e2", fromNodeId: "n1", toNodeId: "n3" }));
        await repo.addEdge(makeEdge({ id: "e3", fromNodeId: "n3", toNodeId: "n2" }));

        expect((await repo.findEdgesFrom("n1")).map((e) => e.id)).toEqual(["e1", "e2"]);
        expect((await repo.findEdgesTo("n2")).map((e) => e.id)).toEqual(["e1", "e3"]);
        expect((await repo.findEdgesBetween("n1", "n2")).map((e) => e.id)).toEqual(["e1"]);
      });

      it("findEdgesFrom/To/Between return empty arrays when nothing matches", async () => {
        const repo = makeRepo();
        expect(await repo.findEdgesFrom("nowhere")).toEqual([]);
        expect(await repo.findEdgesTo("nowhere")).toEqual([]);
        expect(await repo.findEdgesBetween("a", "b")).toEqual([]);
      });

      it("mutating the object passed to addEdge() does not affect the stored edge", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        const original = makeEdge({ confidence: 0.4 });
        await repo.addEdge(original);
        original.confidence = 0.99;
        expect((await repo.getEdge("e1"))?.confidence).toBe(0.4);
      });

      it("mutating an object returned from getEdge()/findEdgesFrom() does not affect the stored edge", async () => {
        const repo = makeRepo();
        await seedTwoNodes(repo);
        await repo.addEdge(makeEdge({ confidence: 0.4 }));

        const fetched = await repo.getEdge("e1");
        if (fetched) fetched.confidence = 0.99;

        const [fromQuery] = await repo.findEdgesFrom("n1");
        fromQuery.confidence = 0.5;

        expect((await repo.getEdge("e1"))?.confidence).toBe(0.4);
      });
    });

    describe("updateEdgeMaturity", () => {
      async function seedEdge(repo: KnowledgeGraphRepository) {
        await repo.addNode(makeNode({ id: "n1" }));
        await repo.addNode(makeNode({ id: "n2" }));
        await repo.addEdge(
          makeEdge({ causalMaturity: "correlated", confidence: 0.3, evidenceCount: 1 })
        );
      }

      it("throws UnknownEdgeError for an edge that does not exist", async () => {
        const repo = makeRepo();
        await expect(
          repo.updateEdgeMaturity("missing", "suspected_causal", 0.5, 2, "2026-07-11T00:00:00Z")
        ).rejects.toThrow(UnknownEdgeError);
      });

      it("allows a single natural step forward", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        const updated = await repo.updateEdgeMaturity(
          "e1",
          "suspected_causal",
          0.6,
          3,
          "2026-07-11T00:00:00Z"
        );
        expect(updated.causalMaturity).toBe("suspected_causal");
        expect(updated.confidence).toBe(0.6);
        expect(updated.evidenceCount).toBe(3);
        expect(updated.lastReinforcedAt).toBe("2026-07-11T00:00:00Z");
        expect((await repo.getEdge("e1"))?.causalMaturity).toBe("suspected_causal");
      });

      it("rejects skipping more than one step without overrideMaturityTransition", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        await expect(
          repo.updateEdgeMaturity("e1", "stable_causal", 0.9, 10, "2026-07-11T00:00:00Z")
        ).rejects.toThrow(InvalidMaturityTransitionError);
      });

      it("rejects overrideMaturityTransition without a reason", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        await expect(
          repo.updateEdgeMaturity("e1", "stable_causal", 0.9, 10, "2026-07-11T00:00:00Z", {
            overrideMaturityTransition: true,
          })
        ).rejects.toThrow(InvalidMaturityTransitionError);
      });

      it("allows skipping steps with overrideMaturityTransition + a reason", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        const updated = await repo.updateEdgeMaturity(
          "e1",
          "stable_causal",
          0.95,
          20,
          "2026-07-11T00:00:00Z",
          { overrideMaturityTransition: true, reason: "manually verified via external audit" }
        );
        expect(updated.causalMaturity).toBe("stable_causal");
      });

      it("rejects a silent downgrade without a reason", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        await repo.updateEdgeMaturity("e1", "suspected_causal", 0.6, 3, "2026-07-11T00:00:00Z");
        await expect(
          repo.updateEdgeMaturity("e1", "correlated", 0.3, 3, "2026-07-11T01:00:00Z")
        ).rejects.toThrow(InvalidMaturityTransitionError);
      });

      it("allows a downgrade when a reason is given", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        await repo.updateEdgeMaturity("e1", "suspected_causal", 0.6, 3, "2026-07-11T00:00:00Z");
        const downgraded = await repo.updateEdgeMaturity(
          "e1",
          "correlated",
          0.3,
          3,
          "2026-07-11T01:00:00Z",
          { reason: "contradicting evidence found" }
        );
        expect(downgraded.causalMaturity).toBe("correlated");
      });

      it("rejects invalid confidence on update", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        await expect(
          repo.updateEdgeMaturity("e1", "suspected_causal", 1.5, 3, "2026-07-11T00:00:00Z")
        ).rejects.toThrow(InvalidConfidenceError);
      });

      it("rejects negative evidenceCount on update", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        await expect(
          repo.updateEdgeMaturity("e1", "suspected_causal", 0.6, -1, "2026-07-11T00:00:00Z")
        ).rejects.toThrow(InvalidEvidenceCountError);
      });

      it("mutating an object returned from updateEdgeMaturity() does not affect the stored edge", async () => {
        const repo = makeRepo();
        await seedEdge(repo);
        const updated = await repo.updateEdgeMaturity(
          "e1",
          "suspected_causal",
          0.6,
          3,
          "2026-07-11T00:00:00Z"
        );
        updated.confidence = 0.99;
        expect((await repo.getEdge("e1"))?.confidence).toBe(0.6);
      });
    });
  });
}
