import { Injectable } from '@nestjs/common';

interface NamespaceCounters {
  activeConnections: number;
  connectionsOpened: number;
  connectionsClosed: number;
  authFailures: number;
  rateLimitRejections: number;
}

@Injectable()
export class WsMetricsService {
  private readonly namespaces = new Map<string, NamespaceCounters>();

  getOrCreate(ns: string): NamespaceCounters {
    let counters = this.namespaces.get(ns);
    if (!counters) {
      counters = {
        activeConnections: 0,
        connectionsOpened: 0,
        connectionsClosed: 0,
        authFailures: 0,
        rateLimitRejections: 0,
      };
      this.namespaces.set(ns, counters);
    }
    return counters;
  }

  incrementConnectionsOpened(ns: string): void {
    const c = this.getOrCreate(ns);
    c.activeConnections++;
    c.connectionsOpened++;
  }

  incrementConnectionsClosed(ns: string): void {
    const c = this.getOrCreate(ns);
    c.activeConnections = Math.max(0, c.activeConnections - 1);
    c.connectionsClosed++;
  }

  incrementAuthFailures(ns: string): void {
    this.getOrCreate(ns).authFailures++;
  }

  incrementRateLimitRejections(ns: string): void {
    this.getOrCreate(ns).rateLimitRejections++;
  }

  getActiveConnections(ns: string): number {
    return this.getOrCreate(ns).activeConnections;
  }

  getSnapshot(ns: string): Readonly<NamespaceCounters> {
    return { ...this.getOrCreate(ns) };
  }

  getAllSnapshots(): Record<string, Readonly<NamespaceCounters>> {
    const result: Record<string, Readonly<NamespaceCounters>> = {};
    for (const [ns, counters] of this.namespaces) {
      result[ns] = { ...counters };
    }
    return result;
  }
}
