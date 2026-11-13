import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE } from './config.ts';
import { openStore } from './db.ts';
import { ingest } from './ingest.ts';
import { listEvents, NO_OPINIONS } from './listing.ts';
import type { SourceItem } from './sources/types.ts';

const at = { today: '2026-11-13', now: 1 };
const labels = new Map([
  ['city', 'City'],
  ['goout', 'GoOut'],
]);

const item = (over: Partial<SourceItem> & { key: string; title: string }, date = '2026-11-20', time: string | null = null): SourceItem => ({
  venue: null,
  address: null,
  lat: 49.2097,
  lon: 16.5887,
  category: 'Music',
  tags: [],
  priceText: null,
  isFree: null,
  url: `https://example.test/${over.key}`,
  description: null,
  imageUrl: null,
  occurrences: [{ startDate: date, startTime: time, endDate: date, endTime: null }],
  ...over,
});

const listing = (store: ReturnType<typeof openStore>) =>
  listEvents(store.upcoming('2026-11-13'), labels, NO_OPINIONS, { from: '2026-11-13', to: '2027-11-13', categories: [], freeOnly: false, place: PLACE });

test('one production listed on several days is one event', () => {
  const store = openStore(':memory:');
  ingest(store, 'city', { items: [item({ key: '1', title: 'Malý princ' }, '2026-11-20'), item({ key: '2', title: 'Malý princ' }, '2026-11-27')], coveredUntil: null }, at);

  const events = listing(store);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.when.startDate, '2026-11-20');
  assert.equal(events[0]?.moreDates, 1);
});

test('the same event from two sources merges, and the timed source gives the time', () => {
  const store = openStore(':memory:');
  ingest(store, 'city', { items: [item({ key: '1', title: 'Vypsaná fixa', description: 'Koncert' })], coveredUntil: null }, at);
  ingest(
    store,
    'goout',
    { items: [item({ key: '9:7', title: 'Vypsaná fixa: Ideál tour 2026', venue: 'Sono', lat: 49.2099, lon: 16.5889 }, '2026-11-20', '20:00')], coveredUntil: null },
    at,
  );

  const events = listing(store);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]?.when, { startDate: '2026-11-20', startTime: '20:00', endDate: '2026-11-20', endTime: null });
  assert.equal(events[0]?.venue, 'Sono');
  assert.equal(events[0]?.description, 'Koncert');
  assert.deepEqual(events[0]?.sources.map((s) => s.label), ['City', 'GoOut']);
});

test('the same title a few streets apart is one event only on a shared day', () => {
  const store = openStore(':memory:');
  ingest(store, 'city', { items: [item({ key: '1', title: 'Čarodky' }), item({ key: '2', title: 'Zlatovláska' })], coveredUntil: null }, at);
  ingest(
    store,
    'goout',
    {
      items: [item({ key: 'a', title: 'Čarodky', lat: 49.2157, lon: 16.5887 }), item({ key: 'b', title: 'Zlatovláska', lat: 49.2157, lon: 16.5887 }, '2026-12-05')],
      coveredUntil: null,
    },
    at,
  );
  assert.deepEqual(listing(store).map((e) => [e.title, e.sources.length]), [
    ['Čarodky', 2],
    ['Zlatovláska', 1],
    ['Zlatovláska', 1],
  ]);
});

test('uncertain matches stay separate', () => {
  const store = openStore(':memory:');
  ingest(store, 'city', { items: [item({ key: '1', title: 'Vypsaná fixa' })], coveredUntil: null }, at);
  ingest(
    store,
    'goout',
    {
      items: [
        item({ key: 'other-day', title: 'Vypsaná fixa: Ideál tour 2026' }, '2026-12-05'),
        item({ key: 'other-place', title: 'Vypsaná fixa: Ideál tour 2026', lat: 49.19, lon: 16.61 }),
        item({ key: 'other-title', title: 'Tata Bojs' }),
        item({ key: 'no-place', title: 'Vypsaná fixa', lat: null, lon: null }),
      ],
      coveredUntil: null,
    },
    at,
  );
  assert.equal(listing(store).length, 5);
});

test('similar titles within one source are not merged through another source', () => {
  const store = openStore(':memory:');
  ingest(store, 'goout', { items: [item({ key: 'g', title: 'Festival Jazz Brno' })], coveredUntil: null }, at);
  ingest(
    store,
    'city',
    { items: [item({ key: '1', title: 'Festival Jazz Brno 2026' }), item({ key: '2', title: 'Festival Jazz Brno: Kamasi Washington' })], coveredUntil: null },
    at,
  );
  assert.equal(listing(store).length, 2);
});

test('a later poll updates in place and keeps the event', () => {
  const store = openStore(':memory:');
  ingest(store, 'city', { items: [item({ key: '1', title: 'Koncert' })], coveredUntil: null }, at);
  const before = listing(store)[0]?.id;
  ingest(store, 'city', { items: [item({ key: '1', title: 'Koncert (přesunuto)' }, '2026-11-22')], coveredUntil: null }, at);

  const events = listing(store);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.id, before);
  assert.equal(events[0]?.title, 'Koncert (přesunuto)');
  assert.equal(events[0]?.when.startDate, '2026-11-22');
});

test('what a source stops listing is removed, but only inside the window it read', () => {
  const store = openStore(':memory:');
  const soon = item({ key: 'soon', title: 'Soon' }, '2026-11-20');
  const far = item({ key: 'far', title: 'Far' }, '2027-03-01');
  const kept = item({ key: 'kept', title: 'Kept' }, '2026-11-21');
  ingest(store, 'goout', { items: [soon, far, kept], coveredUntil: null }, at);

  const partial = ingest(store, 'goout', { items: [kept], coveredUntil: '2026-12-01' }, at);
  assert.equal(partial.removed, 1);
  assert.deepEqual(listing(store).map((e) => e.title), ['Kept', 'Far']);

  const whole = ingest(store, 'goout', { items: [kept], coveredUntil: null }, at);
  assert.equal(whole.removed, 1);
  assert.deepEqual(listing(store).map((e) => e.title), ['Kept']);
});
