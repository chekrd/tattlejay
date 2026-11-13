import type { Place } from './config.ts';
import type { Category, EventSourceLink, EventView, When } from './contract.ts';
import type { StoredRecord } from './db.ts';
import { distanceM } from './geo.ts';

export interface ListQuery {
  from: string;
  to: string;
  categories: Category[];
  freeOnly: boolean;
  place: Place;
}

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

function links(records: StoredRecord[], when: When, labels: Map<string, string>): EventSourceLink[] {
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

function view(records: StoredRecord[], labels: Map<string, string>, q: ListQuery): EventView | undefined {
  const placed = records.filter((r) => r.lat !== null && r.lon !== null);
  if (placed.length > 0 && !placed.some((r) => distanceM(q.place.lat, q.place.lon, r.lat!, r.lon!) <= q.place.radiusKm * 1000)) return undefined;

  const ahead = mergeOccurrences(records.flatMap((r) => r.occurrences)).filter((o) => o.endDate >= q.from);
  const inRange = ahead.filter((o) => o.startDate <= q.to);
  const when = inRange.find((o) => o.startDate >= q.from) ?? inRange[0];
  if (!when) return undefined;

  const category = first(records, (r) => (r.category === 'Other' ? null : r.category)) ?? 'Other';
  if (q.categories.length > 0 && !q.categories.includes(category)) return undefined;
  const isFree = first(records, (r) => r.isFree);
  if (q.freeOnly && isFree !== true) return undefined;

  return {
    id: records[0]!.eventId,
    title: records[0]!.title,
    category,
    venue: first(records, (r) => r.venue),
    address: first(records, (r) => r.address),
    priceText: first(records, (r) => r.priceText),
    isFree,
    description: first(records, (r) => r.description),
    when,
    ongoing: when.startDate < q.from,
    moreDates: ahead.filter((o) => o !== when && o.startDate >= q.from).length,
    sources: links(records, when, labels),
  };
}

// `records` must arrive grouped by event, as Store.upcoming returns them.
export function listEvents(records: StoredRecord[], labels: Map<string, string>, q: ListQuery): EventView[] {
  const events: EventView[] = [];
  let group: StoredRecord[] = [];
  const flush = () => {
    const event = group.length > 0 ? view(group, labels, q) : undefined;
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
