import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE } from '../config.ts';
import { goout } from './goout.ts';

const schedule = (eventId: number, startAt: string, over: Record<string, unknown> = {}) => ({
  id: Math.round(Math.random() * 1e9),
  url: `https://goout.net/schedule/${eventId}`,
  attributes: { state: 'approved', startAt, endAt: startAt, hasTime: true, hasTimeEnd: false, pricing: '250–1350', currency: 'czk', ...over },
  locales: { cs: { siteUrl: `https://goout.net/cs/event-${eventId}/` } },
  relationships: { event: { id: eventId, type: 'event' }, venue: { id: 7, type: 'venue' } },
});

const event = (id: number, name: string, mainCategory: string, over: Record<string, unknown> = {}) => ({
  id,
  attributes: { mainCategory, tags: ['rock'], schedulesRange: { last: '2026-12-27T20:00:01+01:00' }, ...over },
  locales: { cs: { name, description: 'kept out' } },
});

const venue = {
  id: 7,
  attributes: { address: 'Veveří 113', city: 'Brno', latitude: 49.2097, longitude: 16.5887 },
  locales: { cs: { name: 'Sono Music Club' } },
};

const page = (schedules: unknown[], events: unknown[], nextScrollId: string | null) =>
  new Response(JSON.stringify({ meta: { nextScrollId }, schedules, included: { events, venues: [venue] } }));

function fetcher(pages: (() => Response)[]) {
  const urls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const next = pages[urls.length - 1];
    if (!next) throw new Error('no more pages');
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, urls };
}

const context = (fetch: typeof globalThis.fetch) => ({ fetch, pause: async () => {}, today: '2026-11-13', place: PLACE });

const full = (eventId: number, startAt: string) => Array.from({ length: 100 }, () => schedule(eventId, startAt));

test('groups schedules into one item per event and venue, with local times', async () => {
  const { fetch, urls } = fetcher([
    () =>
      page(
        [
          schedule(1, '2026-11-14T19:00:00+01:00'),
          schedule(1, '2026-11-13T18:00:00Z', { hasTimeEnd: true, endAt: '2026-11-13T21:30:00Z' }),
          schedule(2, '2026-11-15T20:00:01+01:00', { hasTime: false, pricing: '0' }),
          schedule(2, '2026-11-16T20:00:01+01:00', { hasTime: false, pricing: '0' }),
          schedule(3, '2026-11-15T10:00:00+01:00', { state: 'cancelled' }),
        ],
        [event(1, 'Vypsaná fixa: Ideál tour 2026', 'concerts'), event(2, 'Tichá hrdinství', 'exhibitions'), event(3, 'Zrušeno', 'play')],
        null,
      ),
  ]);
  const { items, coveredUntil } = await goout.fetchItems(context(fetch));

  assert.equal(coveredUntil, null);
  assert.match(urls[0]!, /cityIds%5B%5D=101748109/);
  assert.deepEqual(items, [
    {
      key: '1:7',
      title: 'Vypsaná fixa: Ideál tour 2026',
      venue: 'Sono Music Club',
      address: 'Veveří 113, Brno',
      lat: 49.2097,
      lon: 16.5887,
      category: 'Music',
      tags: ['rock'],
      priceText: '250–1350 Kč',
      isFree: false,
      url: 'https://goout.net/cs/event-1/',
      description: null,
      imageUrl: null,
      occurrences: [
        { startDate: '2026-11-13', startTime: '19:00', endDate: '2026-11-13', endTime: '22:30' },
        { startDate: '2026-11-14', startTime: '19:00', endDate: '2026-11-14', endTime: null },
      ],
    },
    {
      key: '2:7',
      title: 'Tichá hrdinství',
      venue: 'Sono Music Club',
      address: 'Veveří 113, Brno',
      lat: 49.2097,
      lon: 16.5887,
      category: 'Exhibitions',
      tags: ['rock'],
      priceText: 'Free',
      isFree: true,
      url: 'https://goout.net/cs/event-2/',
      description: null,
      imageUrl: null,
      occurrences: [{ startDate: '2026-11-15', startTime: null, endDate: '2026-12-27', endTime: null }],
    },
  ]);
});

test('follows the scroll id and stops past the horizon', async () => {
  const { fetch, urls } = fetcher([
    () => page(full(1, '2026-11-20T19:00:00+01:00'), [event(1, 'A', 'play')], 'page-2'),
    () => page(full(2, '2027-06-01T19:00:00+02:00'), [event(2, 'B', 'play')], 'page-3'),
    () => page(full(3, '2027-07-01T19:00:00+02:00'), [event(3, 'C', 'play')], 'page-4'),
  ]);
  const { items, coveredUntil } = await goout.fetchItems(context(fetch));

  assert.equal(urls.length, 2);
  assert.doesNotMatch(urls[0]!, /scrollId/);
  assert.match(urls[1]!, /scrollId=page-2/);
  assert.deepEqual(items.map((i) => i.title), ['A', 'B']);
  assert.equal(coveredUntil, '2027-06-01');
});

test('keeps what it read when a later page fails', async () => {
  const { fetch } = fetcher([
    () => page(full(1, '2026-11-20T19:00:00+01:00'), [event(1, 'A', 'play')], 'page-2'),
    () => new Response('busy', { status: 503 }),
  ]);
  const { items, coveredUntil } = await goout.fetchItems(context(fetch));

  assert.deepEqual(items.map((i) => i.title), ['A']);
  assert.equal(coveredUntil, '2026-11-20');
});

test('fails when the first page fails', async () => {
  const { fetch } = fetcher([() => new Response('no', { status: 403 })]);
  await assert.rejects(goout.fetchItems(context(fetch)), /GoOut answered 403/);
});
