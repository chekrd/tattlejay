import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createApp } from './app.ts';
import { PLACE, TIME_ZONE } from './config.ts';
import { openStore } from './db.ts';
import { createPoller } from './poll.ts';
import type { Source, SourceItem } from './sources/types.ts';
import { createTaste } from './taste.ts';

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
  const taste = createTaste(store, {
    ask: async (prompt, system) =>
      system.startsWith('You maintain')
        ? 'You like everything.'
        : JSON.stringify([...prompt.matchAll(/^(\d+) \| /gm)].map((m) => ({ id: Number(m[1]), score: 75, reason: 'You like everything.' }))),
    now: () => NOW,
    timeZone: TIME_ZONE,
  });
  const app = createApp({ store, poller, taste, sources, place: PLACE, timeZone: TIME_ZONE, now: () => NOW });
  return { app, poller, store, taste };
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

test('rating, picks, plans, hidden events and the calendar entry', async () => {
  const { app, poller, taste } = setup(async () => ({ items: [item('a', '2026-11-14'), item('b', '2026-11-19'), item('c', '2026-12-20')], coveredUntil: null }));
  await poller.run();
  const get = async <T>(path: string) => (await (await app.request(`http://127.0.0.1${path}`)).json()) as T;
  const put = (path: string, body: unknown) => app.request(`http://127.0.0.1${path}`, { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const { events } = await get<{ events: { id: number; title: string }[] }>('/api/events?from=2026-11-13&to=2026-12-31');
  const [a, b, c] = events.map((e) => e.id);

  assert.equal((await put(`/api/events/${a}/rating`, { value: 'save' })).status, 200);
  assert.equal((await put(`/api/events/${b}/rating`, { value: 'dislike' })).status, 200);
  assert.equal((await put(`/api/events/${a}/rating`, { value: 'love' })).status, 400);
  assert.equal((await put('/api/events/9999/rating', { value: 'like' })).status, 404);

  assert.deepEqual((await get<{ events: { id: number }[] }>('/api/plans')).events.map((e) => e.id), [a]);
  assert.deepEqual((await get<{ events: { id: number }[] }>('/api/events?from=2026-11-13&to=2026-12-31')).events.map((e) => e.id), [a, c]);
  assert.deepEqual((await get<{ events: { id: number }[] }>('/api/events?from=2026-11-13&to=2026-12-31&hidden=1')).events.map((e) => e.id), [a, b, c]);
  assert.deepEqual((await get<{ events: { id: number }[] }>('/api/starter')).events.map((e) => e.id), [c]);

  assert.equal((await put('/api/taste', { seed: ' I like everything. ' })).status, 200);
  await taste.run();
  const picks = await get<{ week: unknown[]; month: unknown[]; later: { id: number; reason: string }[] }>('/api/picks');
  assert.deepEqual([picks.week, picks.month], [[], []]);
  assert.deepEqual(picks.later.map((e) => [e.id, e.reason]), [[c, 'You like everything.']]);
  assert.deepEqual(await get('/api/taste'), { seed: 'I like everything.', profile: 'You like everything.', rules: [], rated: 2 });

  const ics = await app.request(`http://127.0.0.1/api/events/${a}/calendar.ics`);
  assert.equal(ics.headers.get('content-type'), 'text/calendar; charset=utf-8');
  assert.match(await ics.text(), /SUMMARY:Event a\r\nDTSTART;TZID=Europe\/Prague:20261114T190000/);

  const rules = await app.request('http://127.0.0.1/api/taste/rules', { method: 'POST', body: JSON.stringify({ text: 'Event c', verdict: 'never' }), headers: { 'content-type': 'application/json' } });
  const { rules: saved } = (await rules.json()) as { rules: { id: number }[] };
  assert.deepEqual((await get<{ later: unknown[] }>('/api/picks')).later, []);
  await app.request(`http://127.0.0.1/api/taste/rules/${saved[0]?.id}`, { method: 'DELETE' });
  assert.equal((await get<{ later: unknown[] }>('/api/picks')).later.length, 1);
});
