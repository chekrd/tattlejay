import { z } from 'zod';
import { collapse, plainText, truncate } from '../text.ts';
import { getJson } from './http.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './types.ts';

const ENDPOINT = 'https://impacthub.cz/wp-json/tribe/events/v1/events';
// The Brno house, in the site's own venue numbering.
const BRNO_VENUE = '48721';
const MAX_PAGES = 5;

const Event = z.object({
  id: z.union([z.number(), z.string()]),
  title: z.string().min(1),
  url: z.string().min(1),
  start_date: z.string(),
  end_date: z.string().nullish(),
  all_day: z.boolean().nullish(),
  cost: z.string().nullish(),
  is_virtual: z.boolean().nullish(),
  excerpt: z.string().nullish(),
});

const Page = z.object({ events: z.array(z.unknown()), total_pages: z.number().nullish() });

const stamp = (value: string | null | undefined) => /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(value ?? '');

// Costs read "Zdarma" or "590 Kč -  Kč" (a range with its upper end left empty).
function price(cost: string | null | undefined): Pick<SourceItem, 'priceText' | 'isFree'> {
  const text = collapse(plainText(cost ?? '').replace(/-\s*Kč\s*$/, ''));
  if (!text) return { priceText: null, isFree: null };
  const isFree = /zdarma|free/i.test(text) || /^0\s*Kč$/.test(text);
  return { priceText: text, isFree };
}

export function impactHubItems(raw: unknown[]): SourceItem[] {
  const items: SourceItem[] = [];
  for (const entry of raw) {
    const parsed = Event.safeParse(entry);
    if (!parsed.success) continue;
    const e = parsed.data;
    const online = e.is_virtual === true;
    const start = stamp(e.start_date);
    if (!start) continue;
    const end = stamp(e.end_date);
    const timed = !e.all_day;
    const about = plainText(e.excerpt ?? '');
    items.push({
      key: String(e.id),
      title: plainText(e.title),
      venue: online ? null : 'Impact Hub Brno',
      address: online ? null : 'Cyrilská 7, Brno',
      lat: online ? null : 49.1899,
      lon: online ? null : 16.6206,
      online,
      category: 'Business and networking',
      tags: [],
      ...price(e.cost),
      url: e.url,
      description: about ? truncate(about, 400) : null,
      imageUrl: null,
      occurrences: [
        {
          startDate: start[1]!,
          startTime: timed ? start[2]! : null,
          endDate: end && end[1]! >= start[1]! ? end[1]! : start[1]!,
          endTime: timed && end ? end[2]! : null,
        },
      ],
    });
  }
  return items;
}

async function fetchItems({ fetch, pause, today }: FetchContext): Promise<FetchResult> {
  const events: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await pause(300);
    const params = new URLSearchParams({ venue: BRNO_VENUE, per_page: '50', start_date: today, page: String(page) });
    const body = Page.parse(await getJson(fetch, `${ENDPOINT}?${params}`));
    events.push(...body.events);
    if (page >= (body.total_pages ?? 1)) break;
  }
  return { items: impactHubItems(events), coveredUntil: null };
}

export const impactHub: Source = { id: 'impact-hub', label: 'Impact Hub Brno', home: 'https://impacthub.cz/kalendar/', fetchItems };
