import { TIME_ZONE } from '../config.ts';
import type { When } from '../contract.ts';
import { addDays, localOf } from '../dates.ts';
import { embeddedEvents, str } from '../jsonld.ts';
import { collapse, titleKey } from '../text.ts';
import { getText } from './http.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './types.ts';

const HOME = 'https://www.brno.ai/akce';
// The listing is national; keep what is in or next to Brno.
const NEARBY = /\b(brno|kurim)\b/;

// The page writes a day as local midnight (and the last day as the midnight after it), and a timed event as its time.
function occurrence(start: string | null, end: string | null): When | undefined {
  const from = localOf(start, TIME_ZONE);
  if (!from) return undefined;
  const to = localOf(end, TIME_ZONE);
  if (from.time !== '00:00') {
    const sameDay = to && to.date === from.date;
    return { startDate: from.date, startTime: from.time, endDate: from.date, endTime: sameDay ? to.time : null };
  }
  const last = to ? (to.time === '00:00' ? addDays(to.date, -1) : to.date) : from.date;
  return { startDate: from.date, startTime: null, endDate: last > from.date ? last : from.date, endTime: null };
}

export function brnoAiItems(html: string, today: string): SourceItem[] {
  const items = new Map<string, SourceItem>();
  for (const event of embeddedEvents(html)) {
    const title = str(event.name);
    const when = occurrence(str(event.startDate), str(event.endDate));
    if (!title || !when || when.endDate < today) continue;
    if (str(event.eventAttendanceMode)?.includes('Online')) continue;
    const location = event.location && typeof event.location === 'object' ? (event.location as Record<string, unknown>) : {};
    const where = str(location.name) ?? str(location.address) ?? (typeof event.location === 'string' ? event.location : '');
    if (!NEARBY.test(titleKey(where))) continue;
    const [venue, ...rest] = where.split(',').map((part) => part.trim());
    const key = `${titleKey(title)} ${when.startDate}`;
    items.set(key, {
      key,
      title: collapse(title),
      venue: rest.length > 0 ? (venue ?? null) : null,
      address: rest.length > 0 ? rest.join(', ') : where,
      lat: null,
      lon: null,
      category: 'Tech and meetups',
      tags: ['AI'],
      priceText: null,
      isFree: null,
      url: str(event.url) ?? HOME,
      description: null,
      imageUrl: null,
      occurrences: [when],
    });
  }
  return [...items.values()];
}

export const brnoAi: Source = {
  id: 'brno-ai',
  label: 'Brno.AI',
  home: HOME,
  fetchItems: async ({ fetch, today }: FetchContext): Promise<FetchResult> => ({ items: brnoAiItems(await getText(fetch, HOME), today), coveredUntil: null }),
};
