import { z } from 'zod';
import { TIME_ZONE, USER_AGENT } from '../config.ts';
import type { Category, When } from '../contract.ts';
import { addDays, localDateTime } from '../dates.ts';
import { collapse } from '../text.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './types.ts';

// Not a published API: the endpoint goout.net's own pages call. Only facts are kept (title, time, venue, price, link);
// descriptions and images stay on GoOut.
const ENDPOINT = 'https://goout.net/services/entities/v1/schedules';
const LIMIT = 100;
const MAX_PAGES = 45;
const HORIZON_DAYS = 180;
const PAUSE_MS = 500;

const Locale = <T extends z.ZodRawShape>(shape: T) => z.object({ cs: z.object(shape).nullish() }).nullish();

const Schedule = z.object({
  url: z.string().nullish(),
  attributes: z.object({
    state: z.string().nullish(),
    startAt: z.string(),
    endAt: z.string().nullish(),
    hasTime: z.boolean().nullish(),
    hasTimeEnd: z.boolean().nullish(),
    pricing: z.string().nullish(),
    currency: z.string().nullish(),
  }),
  locales: Locale({ siteUrl: z.string().nullish() }),
  relationships: z.object({
    event: z.object({ id: z.number() }),
    venue: z.object({ id: z.number() }).nullish(),
  }),
});

const Event = z.object({
  id: z.number(),
  attributes: z.object({
    mainCategory: z.string().nullish(),
    tags: z.array(z.string()).nullish(),
    schedulesRange: z.object({ last: z.string().nullish() }).nullish(),
  }),
  locales: Locale({ name: z.string().nullish() }),
});

const Venue = z.object({
  id: z.number(),
  attributes: z.object({
    address: z.string().nullish(),
    city: z.string().nullish(),
    latitude: z.number().nullish(),
    longitude: z.number().nullish(),
  }),
  locales: Locale({ name: z.string().nullish() }),
});

const Page = z.object({
  meta: z.object({ nextScrollId: z.string().nullish() }).nullish(),
  schedules: z.array(z.unknown()),
  included: z.object({ events: z.array(z.unknown()).nullish(), venues: z.array(z.unknown()).nullish() }).nullish(),
});

export type GooutSchedule = z.infer<typeof Schedule>;
export type GooutEvent = z.infer<typeof Event>;
export type GooutVenue = z.infer<typeof Venue>;

// Seen in the feed: concerts, clubbing, play, exhibitions, for_children, in_city. The rest are guesses at its naming.
function category(main: string | null | undefined, tags: string[]): Category {
  switch (main) {
    case 'concerts':
    case 'clubbing':
      return 'Music';
    case 'play':
      return 'Theatre and dance';
    case 'exhibitions':
      return 'Exhibitions';
    case 'film':
      return 'Film';
    case 'for_children':
      return 'Family and kids';
    case 'festivals':
      return 'Festivals';
    case 'sport':
      return 'Sport';
    case 'gastro':
      return 'Food and markets';
  }
  const tagged = (pattern: RegExp) => tags.some((t) => pattern.test(t));
  if (tagged(/talk|discussion|educational|literature|guided_tour|lecture|workshop/)) return 'Talks and lectures';
  if (tagged(/^exhibitions/)) return 'Exhibitions';
  if (tagged(/gastro|food|market/)) return 'Food and markets';
  if (tagged(/^play_|comedy|show|cabaret|musical/)) return 'Theatre and dance';
  return 'Other';
}

function price(pricing: string | null | undefined, currency: string | null | undefined): Pick<SourceItem, 'priceText' | 'isFree'> {
  if (!pricing) return { priceText: null, isFree: null };
  if (/^0+$/.test(pricing)) return { priceText: 'Free', isFree: true };
  const unit = !currency || currency.toLowerCase() === 'czk' ? 'Kč' : currency.toUpperCase();
  return { priceText: `${pricing} ${unit}`, isFree: false };
}

function local(iso: string | null | undefined) {
  if (!iso) return undefined;
  const instant = new Date(iso);
  return Number.isNaN(instant.getTime()) ? undefined : localDateTime(instant, TIME_ZONE);
}

function occurrence(s: GooutSchedule): When | undefined {
  const start = local(s.attributes.startAt);
  if (!start) return undefined;
  if (!s.attributes.hasTime) return { startDate: start.date, startTime: null, endDate: start.date, endTime: null };
  const end = s.attributes.hasTimeEnd ? local(s.attributes.endAt) : undefined;
  if (end && end.date >= start.date) return { startDate: start.date, startTime: start.time, endDate: end.date, endTime: end.time };
  return { startDate: start.date, startTime: start.time, endDate: start.date, endTime: null };
}

export function buildItems(schedules: GooutSchedule[], events: Map<number, GooutEvent>, venues: Map<number, GooutVenue>): SourceItem[] {
  const groups = new Map<string, GooutSchedule[]>();
  for (const s of schedules) {
    if (s.attributes.state && s.attributes.state !== 'approved') continue;
    const key = `${s.relationships.event.id}:${s.relationships.venue?.id ?? 0}`;
    const group = groups.get(key);
    if (group) group.push(s);
    else groups.set(key, [s]);
  }

  const items: SourceItem[] = [];
  for (const [key, group] of groups) {
    const first = group[0]!;
    const event = events.get(first.relationships.event.id);
    const title = collapse(event?.locales?.cs?.name ?? '');
    const url = first.locales?.cs?.siteUrl ?? first.url;
    if (!event || !title || !url) continue;

    let occurrences = group.map(occurrence).filter((o) => o !== undefined);
    if (occurrences.length === 0) continue;
    occurrences.sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

    // An exhibition arrives as one untimed schedule per open day; show it as one run to its last day.
    if (event.attributes.mainCategory === 'exhibitions' && occurrences.every((o) => o.startTime === null)) {
      const startDate = occurrences[0]!.startDate;
      const lastSeen = occurrences.at(-1)!.endDate;
      const lastKnown = local(event.attributes.schedulesRange?.last)?.date ?? lastSeen;
      occurrences = [{ startDate, startTime: null, endDate: lastKnown > lastSeen ? lastKnown : lastSeen, endTime: null }];
    }

    const venue = first.relationships.venue ? venues.get(first.relationships.venue.id) : undefined;
    const tags = event.attributes.tags ?? [];
    const street = venue?.attributes.address;
    const city = venue?.attributes.city;
    items.push({
      key,
      title,
      venue: venue?.locales?.cs?.name ? collapse(venue.locales.cs.name) : null,
      address: street || city ? [street, city].filter(Boolean).join(', ') : null,
      lat: venue?.attributes.latitude ?? null,
      lon: venue?.attributes.longitude ?? null,
      category: category(event.attributes.mainCategory, tags),
      tags,
      ...price(first.attributes.pricing, first.attributes.currency),
      url,
      description: null,
      imageUrl: null,
      occurrences,
    });
  }
  return items;
}

function keep<T extends { id: number }>(into: Map<number, T>, schema: z.ZodType<T>, raw: unknown[] | null | undefined) {
  for (const entry of raw ?? []) {
    const parsed = schema.safeParse(entry);
    if (parsed.success) into.set(parsed.data.id, parsed.data);
  }
}

async function fetchItems({ fetch, pause, today, place }: FetchContext): Promise<FetchResult> {
  const horizon = addDays(today, HORIZON_DAYS);
  const schedules: GooutSchedule[] = [];
  const events = new Map<number, GooutEvent>();
  const venues = new Map<number, GooutVenue>();
  let scrollId: string | null = null;
  let lastDay: string | null = null;
  let reachedEnd = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (page > 0) await pause(PAUSE_MS);
    const params = new URLSearchParams([
      ['languages[]', 'cs'],
      ['cityIds[]', String(place.gooutCityId)],
      ['include', 'events,venues'],
      ['limit', String(LIMIT)],
    ]);
    if (scrollId) params.set('scrollId', scrollId);
    let body: z.infer<typeof Page>;
    try {
      const res = await fetch(`${ENDPOINT}?${params}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
      if (!res.ok) throw new Error(`GoOut answered ${res.status}`);
      body = Page.parse(await res.json());
    } catch (err) {
      if (page === 0) throw err;
      console.warn(`GoOut stopped at page ${page + 1}`, err);
      break;
    }

    keep(events, Event, body.included?.events);
    keep(venues, Venue, body.included?.venues);
    for (const raw of body.schedules) {
      const parsed = Schedule.safeParse(raw);
      if (!parsed.success) continue;
      schedules.push(parsed.data);
      lastDay = local(parsed.data.attributes.startAt)?.date ?? lastDay;
    }

    const next = body.meta?.nextScrollId;
    if (body.schedules.length < LIMIT || !next || next === scrollId) {
      reachedEnd = true;
      break;
    }
    if (lastDay && lastDay > horizon) break;
    scrollId = next;
  }

  return { items: buildItems(schedules, events, venues), coveredUntil: reachedEnd ? null : lastDay };
}

export const goout: Source = { id: 'goout', label: 'GoOut', fetchItems };
