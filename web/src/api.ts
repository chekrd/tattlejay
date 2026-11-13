import type { Capture, Category, EventView, HistoryEntry, PagePreview, Picks, RatingValue, Rule, Status, Taste, Visit } from '../../server/contract.ts';
import type { Range } from './dates.ts';

export interface EventQuery extends Range {
  categories: Category[];
  freeOnly: boolean;
  withHidden: boolean;
  placeId: number;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The app answered ${res.status}`);
  }
  return (await res.json()) as T;
}

const get = async <T>(path: string, signal?: AbortSignal) => json<T>(await fetch(path, signal ? { signal } : {}));

const send = async <T>(method: string, path: string, body?: unknown) =>
  json<T>(await fetch(path, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

export async function fetchEvents(q: EventQuery, signal: AbortSignal): Promise<EventView[]> {
  const params = new URLSearchParams({ from: q.from, to: q.to, place: String(q.placeId) });
  for (const c of q.categories) params.append('category', c);
  if (q.freeOnly) params.set('free', '1');
  if (q.withHidden) params.set('hidden', '1');
  return (await get<{ events: EventView[] }>(`/api/events?${params}`, signal)).events;
}

export const fetchPlans = async (signal: AbortSignal) => (await get<{ events: EventView[] }>('/api/plans', signal)).events;
export const fetchHistory = (signal: AbortSignal) => get<{ entries: HistoryEntry[]; unrated: EventView[] }>('/api/history', signal);
export const fetchStarter = async (signal: AbortSignal) => (await get<{ events: EventView[] }>('/api/starter', signal)).events;
export const fetchPicks = (placeId: number, signal: AbortSignal) => get<Picks>(`/api/picks?place=${placeId}`, signal);
export const fetchTaste = (signal: AbortSignal) => get<Taste>('/api/taste', signal);
export const fetchStatus = (signal: AbortSignal) => get<Status>('/api/status', signal);

export const requestRefresh = () => send<Status>('POST', '/api/refresh');
export const requestPicks = () => send<Status>('POST', '/api/taste/refresh');
export const rate = (eventId: number, value: RatingValue | null, date: string | null) => send<unknown>('PUT', `/api/events/${eventId}/rating`, date ? { value, date } : { value });
export const saveTaste = (change: { seed?: string; profile?: string }) => send<Taste>('PUT', '/api/taste', change);
export const addRule = (text: string, verdict: Rule['verdict']) => send<Taste>('POST', '/api/taste/rules', { text, verdict });
export const removeRule = (id: number) => send<Taste>('DELETE', `/api/taste/rules/${id}`);

export const previewPage = (url: string) => send<PagePreview>('POST', '/api/sources/preview', { url });
export const addPage = (url: string, label: string) => send<Status>('POST', '/api/sources', { url, label });
export const removePage = (id: number) => send<Status>('DELETE', `/api/sources/${id}`);
export const capture = (from: { url?: string; text?: string; picture?: string }) => send<Capture>('POST', '/api/capture', from);
export const addCapture = (token: string) => send<unknown>('POST', '/api/capture/add', { token });
export const visit = (city: string) => send<Visit>('POST', '/api/visit', { city });
