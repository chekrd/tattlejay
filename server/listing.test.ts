import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE } from './config.ts';
import type { When } from './contract.ts';
import type { StoredRecord } from './db.ts';
import { type ListQuery, listEvents, mergeOccurrences } from './listing.ts';

const on = (startDate: string, startTime: string | null = null, endDate = startDate, endTime: string | null = null): When => ({ startDate, startTime, endDate, endTime });

let nextId = 1;
const record = (eventId: number, over: Partial<StoredRecord> = {}): StoredRecord => ({
  id: nextId++,
  eventId,
  source: 'city',
  title: `Event ${eventId}`,
  venue: null,
  address: null,
  lat: PLACE.lat,
  lon: PLACE.lon,
  category: 'Music',
  priceText: null,
  isFree: null,
  url: `https://example.test/${eventId}`,
  description: null,
  occurrences: [on('2026-11-14')],
  ...over,
});

const query = (over: Partial<ListQuery> = {}): ListQuery => ({ from: '2026-11-13', to: '2026-11-19', categories: [], freeOnly: false, place: PLACE, ...over });
const labels = new Map([['city', 'City']]);

test('a day with times replaces the same day without one', () => {
  assert.deepEqual(mergeOccurrences([on('2026-11-14'), on('2026-11-14', '19:00'), on('2026-11-14', '14:00'), on('2026-11-14', '19:00', '2026-11-14', '21:00'), on('2026-11-15')]), [
    on('2026-11-14', '14:00'),
    on('2026-11-14', '19:00', '2026-11-14', '21:00'),
    on('2026-11-15'),
  ]);
});

test('a run absorbs its untimed days but keeps timed events inside it', () => {
  assert.deepEqual(mergeOccurrences([on('2026-11-01', null, '2026-12-27'), on('2026-11-14'), on('2026-11-20', '18:00'), on('2026-11-01', null, '2026-12-27')]), [
    on('2026-11-01', null, '2026-12-27'),
    on('2026-11-20', '18:00'),
  ]);
});

test('lists what falls in the range, in order, with what already runs last', () => {
  const events = listEvents(
    [
      record(1, { occurrences: [on('2026-11-15', '20:00'), on('2026-11-25', '20:00')] }),
      record(2, { occurrences: [on('2026-11-15', '10:00')] }),
      record(3, { occurrences: [on('2026-11-15')] }),
      record(4, { occurrences: [on('2026-10-01', null, '2026-12-31')] }),
      record(5, { occurrences: [on('2026-11-20')] }),
      record(6, { occurrences: [on('2026-11-13')] }),
    ],
    labels,
    query(),
  );
  assert.deepEqual(
    events.map((e) => [e.id, e.ongoing, e.moreDates]),
    [
      [6, false, 0],
      [2, false, 0],
      [1, false, 1],
      [3, false, 0],
      [4, true, 0],
    ],
  );
});

test('filters by category, price and place', () => {
  const records = [
    record(1, { category: 'Film', isFree: true }),
    record(2, { category: 'Music', isFree: false }),
    record(3, { category: 'Music', isFree: true, lat: 50.0755, lon: 14.4378 }),
    record(4, { category: 'Music', isFree: null, lat: null, lon: null }),
  ];
  const ids = (q: Partial<ListQuery>) => listEvents(records, labels, query(q)).map((e) => e.id);
  assert.deepEqual(ids({}), [1, 2, 4]);
  assert.deepEqual(ids({ categories: ['Film', 'Sport'] }), [1]);
  assert.deepEqual(ids({ freeOnly: true }), [1]);
});

test('links to the source record for the shown day', () => {
  const [event] = listEvents(
    [
      record(1, { url: 'https://example.test/past', occurrences: [on('2026-11-13')] }),
      record(1, { url: 'https://example.test/shown', occurrences: [on('2026-11-16')] }),
    ],
    labels,
    query({ from: '2026-11-15' }),
  );
  assert.deepEqual(event?.sources, [{ source: 'city', label: 'City', url: 'https://example.test/shown' }]);
});
