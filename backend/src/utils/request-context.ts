import { AsyncLocalStorage } from "async_hooks";

/**
 * Request-scoped context propagated via Node's AsyncLocalStorage so that
 * tools can record telemetry (sources, etc.) without changing their
 * signatures. The route handler runs the chat turn inside
 * `withRequestContext` and then reads the collected data.
 */

export interface SourceRef {
  url: string;
  title: string;
  service: string;
}

interface RequestContext {
  sources: Map<string, SourceRef>; // dedupe by URL
}

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ sources: new Map() }, fn);
}

export function recordSource(source: SourceRef): void {
  const ctx = storage.getStore();
  if (!ctx || !source?.url) return;
  if (!ctx.sources.has(source.url)) {
    ctx.sources.set(source.url, source);
  }
}

export function getCollectedSources(): SourceRef[] {
  const ctx = storage.getStore();
  return ctx ? Array.from(ctx.sources.values()) : [];
}
