import { z } from 'zod';
import { TIME_ZONE } from '../config.ts';
import { addDays, localOf } from '../dates.ts';
import { collapse } from '../text.ts';
import { getJson } from './http.ts';
import { byStart, type FetchContext, type FetchResult, type Source, type SourceItem } from './types.ts';

const SITE = 'https://www.mdb.cz';
// The API serves 12 performances a page whatever is asked for.
const PAGE_SIZE = 12;
const MAX_PAGES = 20;
const HORIZON_DAYS = 120;

const Performance = z.object({
  start: z.string(),
  canceled: z.boolean().nullish(),
  private: z.boolean().nullish(),
  stage: z.object({ title: z.string().nullish() }).nullish(),
  production: z.object({ title: z.string().min(1), url: z.string().min(1), genre: z.string().nullish() }),
});

const Page = z.object({ member: z.array(z.unknown()) });

export type MdbPerformance = z.infer<typeof Performance>;

export function mdbItems(performances: MdbPerformance[]): SourceItem[] {
  const byProduction = new Map<string, SourceItem>();
  for (const p of performances) {
    const at = localOf(p.start, TIME_ZONE);
    if (!at || p.canceled || p.private) continue;
    let item = byProduction.get(p.production.url);
    if (!item) {
      item = {
        key: p.production.url,
        title: collapse(p.production.title),
        venue: 'Městské divadlo Brno',
        address: 'Lidická 16, Brno',
        lat: 49.2015,
        lon: 16.6077,
        category: 'Theatre and dance',
        tags: [p.production.genre, p.stage?.title].filter((t): t is string => Boolean(t)),
        priceText: null,
        isFree: null,
        url: new URL(p.production.url, SITE).href,
        description: null,
        imageUrl: null,
        occurrences: [],
      };
      byProduction.set(p.production.url, item);
    }
    item.occurrences.push({ startDate: at.date, startTime: at.time, endDate: at.date, endTime: null });
  }
  for (const item of byProduction.values()) item.occurrences.sort(byStart);
  return [...byProduction.values()];
}

async function fetchItems({ fetch, pause, today }: FetchContext): Promise<FetchResult> {
  const performances: MdbPerformance[] = [];
  let lastDay: string | null = null;
  let reachedEnd = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    if (page > 1) await pause(300);
    const params = new URLSearchParams({
      itemsPerPage: String(PAGE_SIZE),
      past: 'false',
      'start[after]': `${today}T00:00:00`,
      'start[before]': `${addDays(today, HORIZON_DAYS)}T23:59:59`,
      page: String(page),
    });
    let members: unknown[];
    try {
      // Asked for plain JSON the API answers with a bare list; asked for JSON-LD, with a collection around it.
      const body = await getJson(fetch, `${SITE}/api/event/events?${params}`);
      members = Array.isArray(body) ? body : Page.parse(body).member;
    } catch (err) {
      if (page === 1) throw err;
      console.warn(`mdb stopped at page ${page}`, err);
      break;
    }
    for (const raw of members) {
      const parsed = Performance.safeParse(raw);
      if (!parsed.success) continue;
      performances.push(parsed.data);
      lastDay = localOf(parsed.data.start, TIME_ZONE)?.date ?? lastDay;
    }
    if (members.length < PAGE_SIZE) {
      reachedEnd = true;
      break;
    }
  }
  return { items: mdbItems(performances), coveredUntil: reachedEnd ? addDays(today, HORIZON_DAYS + 1) : lastDay };
}

export const mdb: Source = { id: 'mdb', label: 'Městské divadlo Brno', home: `${SITE}/cs/program`, neverEmpty: true, fetchItems };
