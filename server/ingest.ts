import type { Store } from './db.ts';
import { distanceM } from './geo.ts';
import type { FetchResult, SourceItem } from './sources/types.ts';
import { compareTitles, titleKey } from './text.ts';

// Sources place the same venue up to a few hundred metres apart: one geocodes the street address, another pins the door.
const SAME_PLACE_M = 250;
const SAME_AREA_M = 1000;
// A box wider than SAME_AREA_M at this latitude; the exact distance is checked afterwards.
const REACH_DEG = 0.015;

// Two entries are one event when they carry the same title at the same place. Two sources also describe one event
// when, on a shared day, they give it the same title in the same area or similar titles at the same place. Anything
// less certain stays separate: a duplicate is visible, a wrong merge hides an event.
function findEvent(store: Store, source: string, item: SourceItem, key: string): number | undefined {
  if (item.lat === null || item.lon === null) return undefined;
  let onSharedDay: number | undefined;
  for (const other of store.neighbours(item.lat, item.lon, REACH_DEG)) {
    const distance = distanceM(item.lat, item.lon, other.lat, other.lon);
    if (distance > SAME_AREA_M) continue;
    const match = compareTitles(key, other.titleKey);
    if (match === 'different') continue;
    if (match === 'exact' && distance <= SAME_PLACE_M) return other.eventId;
    if (onSharedDay !== undefined || (match === 'similar' && distance > SAME_PLACE_M)) continue;
    if (store.sourcesOf(other.eventId).includes(source)) continue;
    const spans = store.spansOf(other.eventId);
    if (item.occurrences.some((o) => spans.some((s) => o.startDate <= s.endDate && o.endDate >= s.startDate))) onSharedDay = other.eventId;
  }
  return onSharedDay;
}

// Where one of two sources gives no coordinates, place cannot vouch for a match. The same title starting at the same
// minute in two sources can: a community calendar re-listing a meetup, a ticket seller listing a theatre's night.
function findByTitleAndTime(store: Store, source: string, item: SourceItem, key: string): number | undefined {
  const timed = item.occurrences.filter((o) => o.startTime !== null);
  if (timed.length === 0) return undefined;
  for (const other of store.titled(key)) {
    if (other.source === source || (other.placed && item.lat !== null)) continue;
    if (store.sourcesOf(other.eventId).includes(source)) continue;
    const spans = store.spansOf(other.eventId);
    if (timed.some((o) => spans.some((s) => s.startDate === o.startDate && s.startTime === o.startTime))) return other.eventId;
  }
  return undefined;
}

export function ingest(store: Store, source: string, result: FetchResult, at: { today: string; now: number }) {
  return store.transaction(() => {
    const seen = new Set<string>();
    for (const item of result.items) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      const key = titleKey(item.title);
      const eventId =
        store.recordOf(source, item.key)?.eventId ??
        findEvent(store, source, item, key) ??
        findByTitleAndTime(store, source, item, key) ??
        store.createEvent(at.now);
      store.saveRecord(eventId, source, item, key, at.now);
    }
    const removed = store.removeMissing(source, seen, at.today, result.coveredUntil);
    return { saved: seen.size, removed };
  });
}
