import { describe, expect, it } from "vitest";
import { InMemoryMetricsCollector } from "../../src/observability/MetricsCollector";

describe("InMemoryMetricsCollector", () => {
  it("returns a zeroed snapshot before any requests are recorded", () => {
    const collector = new InMemoryMetricsCollector();
    const snapshot = collector.snapshot();
    expect(snapshot.requestCount).toBe(0);
    expect(snapshot.errorRate).toBe(0);
    expect(snapshot.latencyMs).toEqual({ p50: 0, p95: 0, max: 0 });
    expect(snapshot.byStatus).toEqual({});
  });

  it("counts requests and buckets them by status", () => {
    const collector = new InMemoryMetricsCollector();
    collector.record({ method: "GET", path: "/a", status: 200, durationMs: 10 });
    collector.record({ method: "GET", path: "/a", status: 200, durationMs: 20 });
    collector.record({ method: "GET", path: "/b", status: 404, durationMs: 5 });

    const snapshot = collector.snapshot();
    expect(snapshot.requestCount).toBe(3);
    expect(snapshot.byStatus).toEqual({ "200": 2, "404": 1 });
  });

  it("only counts 5xx responses toward errorCount/errorRate, not 4xx", () => {
    const collector = new InMemoryMetricsCollector();
    collector.record({ method: "GET", path: "/a", status: 400, durationMs: 1 });
    collector.record({ method: "GET", path: "/a", status: 404, durationMs: 1 });
    collector.record({ method: "GET", path: "/a", status: 500, durationMs: 1 });
    collector.record({ method: "GET", path: "/a", status: 200, durationMs: 1 });

    const snapshot = collector.snapshot();
    expect(snapshot.errorCount).toBe(1);
    expect(snapshot.errorRate).toBe(0.25);
  });

  it("computes latency percentiles from recorded durations", () => {
    const collector = new InMemoryMetricsCollector();
    for (const durationMs of [10, 20, 30, 40, 100]) {
      collector.record({ method: "GET", path: "/a", status: 200, durationMs });
    }
    const snapshot = collector.snapshot();
    expect(snapshot.latencyMs.max).toBe(100);
    expect(snapshot.latencyMs.p50).toBeGreaterThan(0);
    expect(snapshot.latencyMs.p95).toBeGreaterThanOrEqual(snapshot.latencyMs.p50);
  });
});
