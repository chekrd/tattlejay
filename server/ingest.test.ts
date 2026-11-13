import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE } from './config.ts';
import { openStore } from './db.ts';
import { ingest } from './ingest.ts';
import { listEvents, NO_OPINIONS } from './listing.ts';
import type { SourceItem } from './sources/types.ts';

const HOME = { id: 0, ...PLACE };

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
  listEvents(store.upcoming('2026-11-13'), labels, NO_OPINIONS, { from: '2026-11-13', to: '2027-11-13', categories: [], freeOnly: false, place: HOME });

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

test('without coordinates, the same title at the same minute is one event', () => {
  const store = openStore(':memory:');
  ingest(store, 'goout', { items: [item({ key: 'm', title: 'AI 4 DEV @ Brno' }, '2026-11-20', '18:00'), item({ key: 'n', title: 'Pyvo' }, '2026-11-20', '19:00')], coveredUntil: null }, at);
  ingest(
    store,
    'city',
    {
      items: [
        item({ key: '1', title: 'AI 4 DEV @ Brno', lat: null, lon: null }, '2026-11-20', '18:00'),
        item({ key: '2', title: 'Pyvo', lat: null, lon: null }, '2026-11-20', '18:30'),
        item({ key: '3', title: 'Pyvo', lat: null, lon: null }, '2026-11-20'),
      ],
      coveredUntil: null,
    },
    at,
  );
  assert.deepEqual(
    listing(store)
      .map((e) => `${e.title} from ${e.sources.length}`)
      .sort((a, b) => a.localeCompare(b)),
    ['AI 4 DEV @ Brno from 2', 'Pyvo from 1', 'Pyvo from 1', 'Pyvo from 1'],
  );
});

test('a venue named without coordinates takes them from a source that knows the venue', () => {
  const store = openStore(':memory:');
  ingest(
    store,
    'goout',
    { items: [item({ key: 'g', title: 'Jiný večer', venue: 'Reduta', lat: 49.1925, lon: 16.6085 }, '2026-12-01', '19:00'), item({ key: 'h', title: 'Film', venue: 'Kino Art', lat: 49.2043, lon: 16.6036 })], coveredUntil: null },
    at,
  );
  ingest(store, 'city', { items: [item({ key: '1', title: 'Zářivá verbež', lat: 49.1927, lon: 16.6088 })], coveredUntil: null }, at);
  ingest(
    store,
    'page',
    {
      items: [item({ key: 'p', title: 'Zářivá verbež', venue: 'divadlo Reduta', lat: null, lon: null }, '2026-11-20', '19:00'), item({ key: 'q', title: 'Vernisáž', venue: 'Art', lat: null, lon: null })],
      coveredUntil: null,
    },
    at,
  );
  const events = listing(store);
  const merged = events.find((e) => e.title === 'Zářivá verbež');
  assert.deepEqual([merged?.sources.length, merged?.when.startTime, merged?.venue], [2, '19:00', 'divadlo Reduta']);
  assert.equal(events.length, 4);
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

test('dates that have passed are kept when a source moves on to the next ones', () => {
  const store = openStore(':memory:');
  const dates = (...days: string[]) => days.map((d) => ({ startDate: d, startTime: '19:00', endDate: d, endTime: null }));
  ingest(store, 'goout', { items: [item({ key: 's', title: 'Series', occurrences: dates('2026-11-13', '2026-11-20') }), item({ key: 'o', title: 'One night' }, '2026-11-14')], coveredUntil: null }, at);

  const later = { today: '2026-11-18', now: 2 };
  ingest(store, 'goout', { items: [item({ key: 's', title: 'Series', occurrences: dates('2026-11-21', '2026-11-27') })], coveredUntil: null }, later);
  ingest(store, 'goout', { items: [item({ key: 's', title: 'Series', occurrences: dates('2026-11-21', '2026-11-27') })], coveredUntil: null }, later);

  const lastWeek = listEvents(store.upcoming('2026-11-11'), labels, NO_OPINIONS, { from: '2026-11-11', to: '2026-11-17', categories: [], freeOnly: false, place: HOME });
  assert.deepEqual(lastWeek.map((e) => [e.title, e.when.startDate, e.moreDates]), [
    ['Series', '2026-11-13', 2],
    ['One night', '2026-11-14', 0],
  ]);
  const ahead = listEvents(store.upcoming('2026-11-18'), labels, NO_OPINIONS, { from: '2026-11-18', to: '2026-12-31', categories: [], freeOnly: false, place: HOME });
  assert.deepEqual(ahead.map((e) => [e.title, e.when.startDate, e.moreDates]), [['Series', '2026-11-21', 1]]);
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
