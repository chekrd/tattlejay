import type { Place } from './config.ts';
import type { Category, EventSourceLink, EventView, Picks, Rule, When } from './contract.ts';
import { addDays } from './dates.ts';
import type { RatedEvent, Score, StoredRecord } from './db.ts';
import { distanceM } from './geo.ts';
import { titleKey } from './text.ts';

export interface ListedPlace extends Pick<Place, 'lat' | 'lon' | 'radiusKm'> {
  // 0 is home.
  id: number;
}

export interface ListQuery {
  from: string;
  to: string;
  categories: Category[];
  freeOnly: boolean;
  // Null lists events wherever they are.
  place: ListedPlace | null;
  // Disliked events and those under a "never" rule are left out unless asked for.
  withHidden?: boolean;
  savedOnly?: boolean;
  // Online events are listed apart: true lists only them, null both kinds, and left out only events with a place.
  online?: boolean | null;
}

// What the person has said about events, laid over the listing.
export interface Opinions {
  ratings: Map<number, RatedEvent>;
  scores: Map<number, Score>;
  rules: Rule[];
}

export const NO_OPINIONS: Opinions = { ratings: new Map(), scores: new Map(), rules: [] };

const PICK_FROM_SCORE = 60;
const PICKS_PER_GROUP = 5;

const isRun = (o: When) => o.startTime === null && o.endDate > o.startDate;

const byStart = (a: When, b: When) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '');

// Sources describe the same event at different precision: one gives only the day, another the exact times, a third
// the whole run. Keep the most precise statement for each day.
export function mergeOccurrences(all: When[]): When[] {
  const runs = new Map<string, When>();
  const days = new Map<string, { timed: Map<string, When>; untimed: When | undefined }>();
  for (const o of all) {
    if (isRun(o)) {
      runs.set(`${o.startDate}/${o.endDate}`, o);
      continue;
    }
    let day = days.get(o.startDate);
    if (!day) days.set(o.startDate, (day = { timed: new Map(), untimed: undefined }));
    if (o.startTime === null) day.untimed = o;
    else if (!day.timed.get(o.startTime)?.endTime) day.timed.set(o.startTime, o);
  }
  const merged = [...runs.values()];
  for (const [date, day] of days) {
    if (day.timed.size > 0) merged.push(...day.timed.values());
    else if (day.untimed && !merged.some((run) => isRun(run) && run.startDate <= date && run.endDate >= date)) merged.push(day.untimed);
  }
  return merged.sort(byStart);
}

const first = <T>(records: StoredRecord[], pick: (r: StoredRecord) => T | null): T | null => {
  for (const r of records) {
    const value = pick(r);
    if (value !== null) return value;
  }
  return null;
};

// Anything that names a source: a Map does.
export interface Labels {
  get(source: string): string | undefined;
}

function links(records: StoredRecord[], when: When, labels: Labels): EventSourceLink[] {
  const bySource = new Map<string, StoredRecord[]>();
  for (const r of records) {
    const group = bySource.get(r.source);
    if (group) group.push(r);
    else bySource.set(r.source, [r]);
  }
  return [...bySource].map(([source, group]) => {
    const onTheDay = group.find((r) => r.occurrences.some((o) => o.startDate <= when.startDate && o.endDate >= when.startDate));
    return { source, label: labels.get(source) ?? source, url: (onTheDay ?? group[0]!).url };
  });
}

function ruleFor(rules: Rule[], title: string, venue: string | null, verdict: Rule['verdict']): Rule | undefined {
  const haystack = ` ${titleKey(title)} | ${titleKey(venue ?? '')} `;
  return rules.find((rule) => rule.verdict === verdict && titleKey(rule.text) !== '' && haystack.includes(` ${titleKey(rule.text)} `));
}

function view(records: StoredRecord[], labels: Labels, opinions: Opinions, q: ListQuery): EventView | undefined {
  const online = records.every((r) => r.online);
  if (q.online !== null && online !== (q.online ?? false)) return undefined;
  const { place } = q;
  if (place && !online) {
    // An event is here when a source puts it within reach, or, when no source says where it is, when one of them was
    // read for this place.
    const placed = records.filter((r) => r.lat !== null && r.lon !== null);
    const here = placed.length > 0 ? placed.some((r) => distanceM(place.lat, place.lon, r.lat!, r.lon!) <= place.radiusKm * 1000) : records.some((r) => r.placeId === place.id);
    if (!here) return undefined;
  }

  const ahead = mergeOccurrences(records.flatMap((r) => r.occurrences)).filter((o) => o.endDate >= q.from);
  const inRange = ahead.filter((o) => o.startDate <= q.to);
  const when = inRange.find((o) => o.startDate >= q.from) ?? inRange[0];
  if (!when) return undefined;

  const category = first(records, (r) => (r.category === 'Other' ? null : r.category)) ?? 'Other';
  if (q.categories.length > 0 && !q.categories.includes(category)) return undefined;
  const isFree = first(records, (r) => r.isFree);
  if (q.freeOnly && isFree !== true) return undefined;

  const id = records[0]!.eventId;
  const title = records[0]!.title;
  const venue = first(records, (r) => r.venue);
  const rating = opinions.ratings.get(id)?.value ?? null;
  if (q.savedOnly && rating !== 'save') return undefined;
  const hidden = rating === 'dislike' || (rating === null && ruleFor(opinions.rules, title, venue, 'never') !== undefined);
  if (hidden && !q.withHidden) return undefined;
  const always = ruleFor(opinions.rules, title, venue, 'always');
  const score = always ? { score: 100, reason: `You asked to always see “${always.text}”.` } : opinions.scores.get(id);

  return {
    id,
    title,
    category,
    venue,
    address: first(records, (r) => r.address),
    priceText: first(records, (r) => r.priceText),
    isFree,
    description: first(records, (r) => r.description),
    when,
    ongoing: when.startDate < q.from,
    moreDates: ahead.filter((o) => o !== when && o.startDate >= q.from).length,
    sources: links(records, when, labels),
    online,
    rating,
    hidden,
    score: score?.score ?? null,
    reason: score?.reason ?? null,
  };
}

// `records` must arrive grouped by event, as Store.upcoming returns them.
export function listEvents(records: StoredRecord[], labels: Labels, opinions: Opinions, q: ListQuery): EventView[] {
  const events: EventView[] = [];
  let group: StoredRecord[] = [];
  const flush = () => {
    const event = group.length > 0 ? view(group, labels, opinions, q) : undefined;
    if (event) events.push(event);
  };
  for (const r of records) {
    if (group.length > 0 && group[0]!.eventId !== r.eventId) {
      flush();
      group = [];
    }
    group.push(r);
  }
  flush();

  return events.sort((a, b) => {
    if (a.ongoing !== b.ongoing) return a.ongoing ? 1 : -1;
    if (a.ongoing) return a.when.endDate.localeCompare(b.when.endDate) || a.title.localeCompare(b.title);
    return (
      a.when.startDate.localeCompare(b.when.startDate) ||
      (a.when.startTime ?? '99').localeCompare(b.when.startTime ?? '99') ||
      a.title.localeCompare(b.title)
    );
  });
}

// The strongest matches the person has not rated yet, by how soon they happen. `events` is the listing from today on.
export function pickEvents(events: EventView[], today: string): Picks {
  const weekEnd = addDays(today, 6);
  const monthEnd = addDays(today, 30);
  const picks: Picks = { week: [], month: [], later: [] };
  const strongest = events
    .filter((e) => e.rating === null && !e.hidden && e.score !== null && e.score >= PICK_FROM_SCORE)
    .sort((a, b) => b.score! - a.score! || a.when.startDate.localeCompare(b.when.startDate));
  for (const event of strongest) {
    const group = event.when.startDate <= weekEnd ? picks.week : event.when.startDate <= monthEnd ? picks.month : picks.later;
    if (group.length < PICKS_PER_GROUP) group.push(event);
  }
  return picks;
}

// A spread of real events to rate first, taking turns between categories so the first ratings say something about each.
export function starterEvents(events: EventView[], count: number): EventView[] {
  const byCategory = new Map<Category, EventView[]>();
  for (const event of events) {
    if (event.rating !== null || event.hidden || event.ongoing) continue;
    const group = byCategory.get(event.category);
    if (group) group.push(event);
    else byCategory.set(event.category, [event]);
  }
  const starters: EventView[] = [];
  for (let round = 0; starters.length < count; round++) {
    let took = false;
    for (const group of byCategory.values()) {
      const event = group[round];
      if (!event || starters.length >= count) continue;
      starters.push(event);
      took = true;
    }
    if (!took) break;
  }
  return starters;
}
