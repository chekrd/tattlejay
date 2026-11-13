import { TIME_ZONE } from '../config.ts';
import type { Category } from '../contract.ts';
import { type IcsEvent, parseIcs } from '../ics.ts';
import { collapse, truncate } from '../text.ts';
import { getText } from './http.ts';
import type { FetchContext, FetchResult, Source, SourceItem, Venue } from './types.ts';

interface CalendarSpec {
  id: string;
  label: string;
  home: string;
  feeds: string[];
  category: Category;
  // Used where an event names no place of its own.
  venue?: Venue;
  skip?: (event: IcsEvent) => boolean;
}

const isUrl = (text: string) => /^https?:\/\/\S+$/.test(text);

function place(event: IcsEvent, fallback: Venue | undefined): Pick<SourceItem, 'venue' | 'address' | 'lat' | 'lon'> {
  const location = isUrl(event.location) ? '' : collapse(event.location);
  const [name, ...rest] = location.split(',').map((part) => part.trim());
  return {
    venue: name || fallback?.venue || null,
    address: rest.join(', ') || (name ? null : (fallback?.address ?? null)),
    lat: event.lat ?? fallback?.lat ?? null,
    lon: event.lon ?? fallback?.lon ?? null,
  };
}

export function calendarItems(text: string, spec: Pick<CalendarSpec, 'home' | 'category' | 'venue' | 'skip'>, today: string): SourceItem[] {
  return parseIcs(text, TIME_ZONE)
    .filter((e) => !e.cancelled && e.when.endDate >= today && !spec.skip?.(e))
    .map((e) => ({
      key: e.uid,
      title: collapse(e.summary),
      ...place(e, spec.venue),
      category: spec.category,
      tags: [],
      priceText: null,
      isFree: null,
      url: e.url ?? (isUrl(e.location) ? e.location : (/https?:\/\/\S+/.exec(e.description)?.[0] ?? spec.home)),
      description: e.description ? truncate(collapse(e.description), 400) : null,
      imageUrl: null,
      occurrences: [e.when],
    }));
}

// A source made of one or more published calendar feeds.
export function calendarSource(spec: CalendarSpec): Source {
  async function fetchItems({ fetch, pause, today }: FetchContext): Promise<FetchResult> {
    const items: SourceItem[] = [];
    let failures = 0;
    let lastError: unknown;
    for (const [i, feed] of spec.feeds.entries()) {
      if (i > 0) await pause(300);
      try {
        items.push(...calendarItems(await getText(fetch, feed), spec, today));
      } catch (err) {
        failures++;
        lastError = err;
      }
    }
    if (failures === spec.feeds.length) throw lastError;
    // With a feed unread, its events are unknown rather than gone: claim nothing beyond today.
    return { items, coveredUntil: failures > 0 ? today : null };
  }
  return { id: spec.id, label: spec.label, home: spec.home, fetchItems };
}

export const pyvo = calendarSource({
  id: 'pyvo',
  label: 'Pyvo',
  home: 'https://pyvo.cz/brno-pyvo/',
  feeds: ['https://pyvo.cz/api/series/brno-pyvo.ics'],
  category: 'Tech and meetups',
  // The series pencils in its usual day months ahead as "nepotvrzeno" (unconfirmed).
  skip: (e) => /nepotvrzeno/i.test(e.summary),
});

export const wug = calendarSource({
  id: 'wug',
  label: 'WUG Brno',
  home: 'https://www.wug.cz/brno',
  feeds: ['https://www.wug.cz/brno/ical'],
  category: 'Tech and meetups',
});

// The hackerspace's calendar mixes public events with its own housekeeping.
export const base48 = calendarSource({
  id: 'base48',
  label: 'Base48',
  home: 'https://base48.cz/',
  feeds: ['https://nextcloud.at.base48.cz/remote.php/dav/public-calendars/oM82tg3RJDLDyZbz?export'],
  category: 'Tech and meetups',
  venue: { venue: 'Base48 hackerspace', address: 'Brno', lat: null, lon: null },
  skip: (e) => e.recurring || /council meeting|valná hromada|private event/i.test(e.summary),
});

// Luma's supported interface: one calendar subscription per community. Add a community by adding its calendar id.
const LUMA_CALENDARS = ['cal-uErllWAcQPDGktK', 'cal-FDlygORYPoG70xg', 'cal-d4x0aXpLTiJVdiQ'];

export const luma = calendarSource({
  id: 'luma',
  label: 'Luma',
  home: 'https://luma.com/brno',
  feeds: LUMA_CALENDARS.map((id) => `https://api.lu.ma/ics/get?entity=calendar&id=${id}`),
  category: 'Tech and meetups',
});
