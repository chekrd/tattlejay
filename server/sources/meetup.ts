import { z } from 'zod';
import { TIME_ZONE } from '../config.ts';
import { localOf } from '../dates.ts';
import { collapse, titleKey, truncate } from '../text.ts';
import { getText } from './http.ts';
import type { FetchContext, FetchResult, Source, SourceItem } from './types.ts';

// Meetup's API is closed to ordinary accounts and its calendar feeds name no venue, so each group's public events page
// is read for the data it embeds. Add a group by adding the name from its address.
export const MEETUP_GROUPS = [
  'frontendisti',
  'ai-4-dev',
  'brno-java-meetup',
  'Machine-Learning-Meetup-Brno',
  'golang-brno',
  'devops-club-brno',
  'Brno-Python-Meetup',
  'brno-aws-user-group',
  'dataheads',
  'cppbrno',
  'Information-security-Brno',
  'brno-embedded-ai-community',
  'react-brno-meetups',
  'meetupdate-brno',
  'ai-zero-to-done',
  'grafana-friends-brno',
  'gdgbrno',
  'databricks-brno-user-group',
  'cybersecurityplatform-cz',
];

const Event = z.object({
  id: z.string(),
  title: z.string().min(1),
  eventUrl: z.string().min(1),
  dateTime: z.string(),
  endTime: z.string().nullish(),
  eventType: z.string().nullish(),
  description: z.string().nullish(),
  venue: z.object({ __ref: z.string() }).nullish(),
});

const Venue = z.object({ name: z.string().nullish(), address: z.string().nullish(), city: z.string().nullish() });

const State = z.object({ props: z.object({ pageProps: z.object({ __APOLLO_STATE__: z.record(z.string(), z.unknown()) }) }) });

const EMBEDDED = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;

function address(street: string | null | undefined, city: string | null | undefined): string | null {
  if (!street) return city ?? null;
  return city && !titleKey(street).includes(titleKey(city)) ? `${street}, ${city}` : street;
}

// Groups also post their events in other cities and online; only those with a venue in the city are kept.
export function meetupItems(html: string, today: string, city: string): SourceItem[] {
  const embedded = EMBEDDED.exec(html)?.[1];
  if (!embedded) throw new Error('the Meetup page carried no event data');
  const state = State.parse(JSON.parse(embedded)).props.pageProps.__APOLLO_STATE__;
  const items: SourceItem[] = [];
  for (const [key, raw] of Object.entries(state)) {
    if (!key.startsWith('Event:')) continue;
    const parsed = Event.safeParse(raw);
    if (!parsed.success) continue;
    const e = parsed.data;
    const start = localOf(e.dateTime, TIME_ZONE);
    const venue = Venue.safeParse(e.venue ? state[e.venue.__ref] : undefined);
    if (!start || start.date < today || !venue.success || e.eventType === 'ONLINE') continue;
    if (!titleKey(venue.data.city ?? '').startsWith(titleKey(city))) continue;
    const end = localOf(e.endTime, TIME_ZONE);
    items.push({
      key: e.id,
      title: collapse(e.title),
      venue: venue.data.name ? collapse(venue.data.name) : null,
      address: address(venue.data.address, venue.data.city),
      lat: null,
      lon: null,
      category: 'Tech and meetups',
      tags: [],
      priceText: null,
      isFree: null,
      url: e.eventUrl,
      description: e.description ? truncate(collapse(e.description), 400) : null,
      imageUrl: null,
      occurrences: [{ startDate: start.date, startTime: start.time, endDate: end && end.date >= start.date ? end.date : start.date, endTime: end ? end.time : null }],
    });
  }
  return items;
}

async function fetchItems({ fetch, pause, today, place }: FetchContext): Promise<FetchResult> {
  const items: SourceItem[] = [];
  let failures = 0;
  let lastError: unknown;
  for (const [i, group] of MEETUP_GROUPS.entries()) {
    if (i > 0) await pause(400);
    try {
      items.push(...meetupItems(await getText(fetch, `https://www.meetup.com/${group}/events/`), today, place.name));
    } catch (err) {
      failures++;
      lastError = err;
    }
  }
  if (failures === MEETUP_GROUPS.length) throw lastError;
  if (failures > 0) console.warn(`meetup: ${failures} of ${MEETUP_GROUPS.length} groups could not be read`);
  return { items, coveredUntil: failures > 0 ? today : null };
}

export const meetup: Source = { id: 'meetup', label: 'Meetup', home: 'https://www.meetup.com/find/?location=cz--Brno&source=EVENTS', fetchItems };
