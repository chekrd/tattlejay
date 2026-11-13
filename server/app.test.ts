import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.ts';
import { PLACE, TIME_ZONE } from './config.ts';
import { openStore } from './db.ts';
import { createPoller } from './poll.ts';
import type { Source, SourceItem } from './sources/types.ts';

const NOW = Date.parse('2026-11-13T09:00:00Z');

const item = (key: string, date: string): SourceItem => ({
  key,
  title: `Event ${key}`,
  venue: 'Somewhere',
  address: null,
  lat: PLACE.lat,
  lon: PLACE.lon,
  category: 'Music',
  tags: [],
  priceText: null,
  isFree: null,
  url: `https://example.test/${key}`,
  description: null,
  imageUrl: null,
  occurrences: [{ startDate: date, startTime: '19:00', endDate: date, endTime: null }],
});

function setup(fetchItems: Source['fetchItems']) {
  const store = openStore(':memory:');
  const sources: Source[] = [{ id: 'fake', label: 'Fake', fetchItems }];
  const poller = createPoller(store, sources, { fetch, pause: async () => {}, now: () => NOW, place: PLACE, timeZone: TIME_ZONE, everyMs: 3_600_000 });
  const app = createApp({ store, poller, sources, place: PLACE, timeZone: TIME_ZONE, now: () => NOW });
  return { app, poller, store };
}

test('a poll lands in the listing, which defaults to the week from today', async () => {
  const { app, poller } = setup(async () => ({ items: [item('a', '2026-11-14'), item('b', '2026-11-19'), item('c', '2026-11-20')], coveredUntil: null }));
  await poller.run();

  const res = await app.request('http://127.0.0.1/api/events');
  const body = (await res.json()) as { from: string; to: string; events: { title: string }[] };
  assert.equal(res.status, 200);
  assert.deepEqual([body.from, body.to], ['2026-11-13', '2026-11-19']);
  assert.deepEqual(body.events.map((e) => e.title), ['Event a', 'Event b']);

  const status = (await (await app.request('http://127.0.0.1/api/status')).json()) as { sources: unknown[] };
  assert.deepEqual(status.sources, [{ id: 'fake', label: 'Fake', lastOkAt: NOW, lastError: null, lastCount: 3 }]);
});

test('a source that is not due is left alone, and a failing one keeps its events', async () => {
  let calls = 0;
  const { app, poller } = setup(async () => {
    calls++;
    if (calls === 1) return { items: [item('a', '2026-11-14')], coveredUntil: null };
    if (calls === 2) return { items: [], coveredUntil: null };
    throw new Error('offline');
  });
  await poller.run();
  await poller.run();
  assert.equal(calls, 1);

  await poller.run(true);
  await poller.run(true);
  assert.equal(calls, 3);
  const status = (await (await app.request('http://127.0.0.1/api/status')).json()) as { sources: { lastError: string; lastOkAt: number }[] };
  assert.equal(status.sources[0]?.lastError, 'offline');
  assert.equal(status.sources[0]?.lastOkAt, NOW);
  const body = (await (await app.request('http://127.0.0.1/api/events')).json()) as { events: unknown[] };
  assert.equal(body.events.length, 1);
});

test('rejects bad dates and pages from elsewhere', async () => {
  const { app } = setup(async () => ({ items: [], coveredUntil: null }));
  assert.equal((await app.request('http://127.0.0.1/api/events?from=2026-11-20&to=2026-11-13')).status, 400);
  assert.equal((await app.request('http://127.0.0.1/api/events?from=tomorrow')).status, 400);
  assert.equal((await app.request('http://evil.test/api/status')).status, 403);
  assert.equal((await app.request('http://127.0.0.1/api/refresh', { method: 'POST', headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await app.request('http://localhost/api/refresh', { method: 'POST', headers: { origin: 'http://127.0.0.1:5174' } })).status, 202);
});
