import { z } from 'zod';
import { TIME_ZONE } from '../config.ts';
import { addDays, localOf } from '../dates.ts';
import { collapse, titleKey, truncate } from '../text.ts';
import { getText } from './http.ts';
import type { Category } from '../contract.ts';
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
  feeSettings: z.unknown().nullish(),
  // A reference into the page's other records, or (on search pages) the record itself.
  venue: z.record(z.string(), z.unknown()).nullish(),
  group: z.record(z.string(), z.unknown()).nullish(),
});

type MeetupEvent = z.infer<typeof Event>;

const Venue = z.object({ name: z.string().nullish(), address: z.string().nullish(), city: z.string().nullish() });

const Group = z.object({ name: z.string().nullish() });

const State = z.object({ props: z.object({ pageProps: z.object({ __APOLLO_STATE__: z.record(z.string(), z.unknown()) }) }) });

const EMBEDDED = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
// A group's page still shows its recent events. They are taken, so the past week can be looked back on.
const KEEP_PAST_DAYS = 7;

function address(street: string | null | undefined, city: string | null | undefined): string | null {
  if (!street) return city ?? null;
  return city && !titleKey(street).includes(titleKey(city)) ? `${street}, ${city}` : street;
}

// The events and what they point to (venues, groups), as a Meetup page embeds them for itself.
function pageState(html: string): Record<string, unknown> {
  const embedded = EMBEDDED.exec(html)?.[1];
  if (!embedded) throw new Error('the Meetup page carried no event data');
  return State.parse(JSON.parse(embedded)).props.pageProps.__APOLLO_STATE__;
}

function resolve(state: Record<string, unknown>, link: Record<string, unknown> | null | undefined): unknown {
  return typeof link?.__ref === 'string' ? state[link.__ref] : link;
}

function* events(state: Record<string, unknown>, today: string) {
  for (const [key, raw] of Object.entries(state)) {
    if (!key.startsWith('Event:')) continue;
    const parsed = Event.safeParse(raw);
    if (!parsed.success) continue;
    const start = localOf(parsed.data.dateTime, TIME_ZONE);
    if (start && start.date >= addDays(today, -KEEP_PAST_DAYS)) yield { event: parsed.data, start };
  }
}

function item(e: MeetupEvent, start: { date: string; time: string }, over: Partial<SourceItem>): SourceItem {
  const end = localOf(e.endTime, TIME_ZONE);
  return {
    key: e.id,
    title: collapse(e.title),
    venue: null,
    address: null,
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
    ...over,
  };
}

// Groups also post their events in other cities; those with a venue in the city are kept, and those online.
export function meetupItems(html: string, today: string, city: string): SourceItem[] {
  const state = pageState(html);
  const items: SourceItem[] = [];
  for (const { event: e, start } of events(state, today)) {
    if (e.eventType === 'ONLINE') {
      items.push(item(e, start, { online: true }));
      continue;
    }
    const venue = Venue.safeParse(resolve(state, e.venue));
    if (!venue.success || !titleKey(venue.data.city ?? '').startsWith(titleKey(city))) continue;
    items.push(item(e, start, { venue: venue.data.name ? collapse(venue.data.name) : null, address: address(venue.data.address, venue.data.city) }));
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

// Meetup's search, asked for online events near the city, one topic at a time: each answer holds only the first dozen,
// and asking per topic reaches more. The topic numbers are those of Meetup's own topic links; 546 and 405 were checked.
const SEARCH_TOPICS: [id: number, label: string, category: Category][] = [
  [546, 'Technology', 'Tech and meetups'],
  [405, 'Career & Business', 'Business and networking'],
  [436, 'Science & Education', 'Talks and lectures'],
  [521, 'Art & Culture', 'Talks and lectures'],
  [395, 'Music', 'Music'],
  [612, 'Dancing', 'Theatre and dance'],
  [467, 'Writing', 'Talks and lectures'],
  [622, 'Identity & Language', 'Talks and lectures'],
  [604, 'Community & Environment', 'Talks and lectures'],
  [642, 'Movements & Politics', 'Talks and lectures'],
  [449, 'Support & Coaching', 'Talks and lectures'],
  [511, 'Health & Wellbeing', 'Talks and lectures'],
  [482, 'Sports & Fitness', 'Sport'],
  [673, 'Parents & Family', 'Family and kids'],
  [571, 'Hobbies & Passions', 'Other'],
  [652, 'Social Activities', 'Other'],
  [535, 'Games', 'Other'],
];

const searchUrl = (location: string, topic: number) => `https://www.meetup.com/find/?location=${location}&source=EVENTS&eventType=online&categoryId=${topic}`;

export function meetupOnlineItems(html: string, today: string, topic: string, category: Category): SourceItem[] {
  const state = pageState(html);
  const items: SourceItem[] = [];
  for (const { event: e, start } of events(state, today)) {
    if (e.eventType !== 'ONLINE') continue;
    const group = Group.safeParse(resolve(state, e.group));
    const host = group.success && group.data.name ? collapse(group.data.name) : null;
    const about = e.description ? truncate(collapse(e.description), 400) : null;
    items.push(
      item(e, start, {
        online: true,
        category,
        tags: host ? [topic, host] : [topic],
        // Meetup gives a fee only for paid events.
        isFree: !e.feeSettings,
        description: [host && `Hosted by ${host}.`, about].filter(Boolean).join(' ') || null,
      }),
    );
  }
  return items;
}

async function fetchOnline({ fetch, pause, today, place }: FetchContext): Promise<FetchResult> {
  const items: SourceItem[] = [];
  let failures = 0;
  let lastError: unknown;
  for (const [i, [id, label, category]] of SEARCH_TOPICS.entries()) {
    if (i > 0) await pause(500);
    try {
      items.push(...meetupOnlineItems(await getText(fetch, searchUrl(place.meetupLocation, id)), today, label, category));
    } catch (err) {
      failures++;
      lastError = err;
    }
  }
  if (failures === SEARCH_TOPICS.length) throw lastError;
  // A search shows a few of many events, so one missing from it is not known to be cancelled.
  return { items, coveredUntil: today };
}

export const meetupOnline: Source = {
  id: 'meetup-online',
  label: 'Meetup online',
  home: 'https://www.meetup.com/find/?location=cz--Brno&source=EVENTS&eventType=online',
  fetchItems: fetchOnline,
};
