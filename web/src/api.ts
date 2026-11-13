import type { Category, EventView, Status } from '../../server/contract.ts';
import type { Range } from './dates.ts';

export interface EventQuery extends Range {
  categories: Category[];
  freeOnly: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`The app answered ${res.status}`);
  return (await res.json()) as T;
}

export async function fetchEvents(q: EventQuery, signal: AbortSignal): Promise<EventView[]> {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  for (const c of q.categories) params.append('category', c);
  if (q.freeOnly) params.set('free', '1');
  const body = await json<{ events: EventView[] }>(await fetch(`/api/events?${params}`, { signal }));
  return body.events;
}

export const fetchStatus = async (signal?: AbortSignal) => json<Status>(await fetch('/api/status', signal ? { signal } : {}));

export const requestRefresh = async () => json<Status>(await fetch('/api/refresh', { method: 'POST' }));
