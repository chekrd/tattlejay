import type { Place } from './config.ts';
import { today } from './dates.ts';
import type { Store } from './db.ts';
import { ingest } from './ingest.ts';
import type { Source } from './sources/types.ts';

const RETRY_AFTER_MS = 3_600_000;

export interface PollerDeps {
  fetch: typeof fetch;
  pause: (ms: number) => Promise<void>;
  now: () => number;
  place: Place;
  timeZone: string;
  everyMs: number;
}

export function createPoller(store: Store, sources: Source[], deps: PollerDeps) {
  const attemptedAt = new Map<string, number>();
  let running: Promise<void> | null = null;

  async function pollAll(force: boolean) {
    for (const source of sources) {
      const state = store.sourceState(source.id);
      const started = deps.now();
      if (!force) {
        if (state.lastOkAt !== null && started - state.lastOkAt < deps.everyMs) continue;
        if (started - (attemptedAt.get(source.id) ?? -Infinity) < RETRY_AFTER_MS) continue;
      }
      attemptedAt.set(source.id, started);
      try {
        const day = today(deps.timeZone, new Date(started));
        const result = await source.fetchItems({ fetch: deps.fetch, pause: deps.pause, today: day, place: deps.place });
        // An empty answer is far likelier a broken feed than a city with nothing on, and would drop every known event.
        if (result.items.length === 0) throw new Error('returned no events');
        const { saved, removed } = ingest(store, source.id, result, { today: day, now: deps.now() });
        store.setSourceState(source.id, { lastOkAt: deps.now(), lastError: null, lastCount: saved });
        console.log(`${source.id}: ${saved} events, ${removed} removed`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        store.setSourceState(source.id, { ...state, lastError: message });
        console.warn(`${source.id} failed: ${message}`);
      }
    }
  }

  return {
    get polling() {
      return running !== null;
    },
    // Polls the sources that are due, or all of them when forced. A call while a poll runs joins that poll.
    run(force = false): Promise<void> {
      running ??= pollAll(force).finally(() => {
        running = null;
      });
      return running;
    },
  };
}

export type Poller = ReturnType<typeof createPoller>;
