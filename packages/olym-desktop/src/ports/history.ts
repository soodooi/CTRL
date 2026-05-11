// History Port — AI memory abstraction (bridges to @ctrl/memory event store).
// Stub for P3 Step b — full impl after ctrl-memory cherry-pick from screi.

export interface HistoryEvent {
  readonly id: string;
  readonly tsMs: number;
  readonly actorId: string;
  readonly kind: string;
  readonly payload: unknown;
}

export interface HistoryQuery {
  readonly actorId?: string;
  readonly kind?: string;
  readonly fromMs?: number;
  readonly toMs?: number;
  readonly limit?: number;
}

export interface HistoryPort {
  append(event: HistoryEvent): Promise<void>;
  query(q: HistoryQuery): Promise<HistoryEvent[]>;
  replay(actorId: string): AsyncIterable<HistoryEvent>;
}
