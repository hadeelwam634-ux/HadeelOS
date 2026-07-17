export interface RequestMetricSample {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
}

export interface MetricsSnapshot {
  readonly requestCount: number;
  readonly errorCount: number;
  /** errorCount / requestCount, or 0 when no requests have been recorded. */
  readonly errorRate: number;
  readonly latencyMs: {
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
  };
  /** Count of requests per HTTP status code, e.g. { "200": 12, "404": 2 }. */
  readonly byStatus: Readonly<Record<string, number>>;
}

/**
 * Injectable metrics seam (same pattern as Logger/Clock/IdGenerator).
 * A "status >= 500" response counts as an error; 4xx responses are
 * expected client-error traffic and are tracked in `byStatus` but not
 * counted toward `errorRate`, so a spike in 400s from bad client input
 * doesn't page anyone the way a spike in 500s should.
 */
export interface MetricsCollector {
  record(sample: RequestMetricSample): void;
  snapshot(): MetricsSnapshot;
}

export class InMemoryMetricsCollector implements MetricsCollector {
  private requestCount = 0;
  private errorCount = 0;
  private readonly durations: number[] = [];
  private readonly byStatus = new Map<number, number>();

  record(sample: RequestMetricSample): void {
    this.requestCount += 1;
    if (sample.status >= 500) {
      this.errorCount += 1;
    }
    this.durations.push(sample.durationMs);
    this.byStatus.set(sample.status, (this.byStatus.get(sample.status) ?? 0) + 1);
  }

  snapshot(): MetricsSnapshot {
    const sorted = [...this.durations].sort((a, b) => a - b);
    const byStatus: Record<string, number> = {};
    for (const [status, count] of this.byStatus.entries()) {
      byStatus[String(status)] = count;
    }
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount === 0 ? 0 : this.errorCount / this.requestCount,
      latencyMs: {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
      },
      byStatus,
    };
  }
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.floor(p * sortedValues.length));
  return sortedValues[index];
}
