import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE, TIME_ZONE } from './config.ts';
import { openStore } from './db.ts';
import { listEvents, NO_OPINIONS } from './listing.ts';
import { createVisits, VISIT_LABELS } from './visit.ts';

const NOW = Date.parse('2026-11-13T09:00:00Z');

const schedule = (eventId: number, venueId: number, startAt: string) => ({
  attributes: { state: 'approved', startAt, hasTime: true, hasTimeEnd: false, pricing: '200', currency: 'czk' },
  locales: { cs: { siteUrl: `https://goout.net/cs/e${eventId}/` } },
  relationships: { event: { id: eventId, type: 'event' }, venue: { id: venueId, type: 'venue' } },
});
const event = (id: number, name: string) => ({ id, attributes: { mainCategory: 'concerts', tags: [] }, locales: { cs: { name } } });
const venue = (id: number, name: string, lat: number, lon: number) => ({ id, attributes: { address: 'Ulice 1', city: 'Olomouc', latitude: lat, longitude: lon }, locales: { cs: { name } } });

function setup(kudyReply = '[]') {
  const store = openStore(':memory:');
  const requests: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = decodeURIComponent(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push(url);
    if (url.includes('countryIsos[]=cz')) return Response.json({ meta: { nextScrollId: null }, included: { cities: [{ id: 77, locales: { cs: { name: 'Olomouc' } } }] } });
    if (url.includes('cityIds[]=77') || url.includes('cityIds[]=101748113')) {
      return Response.json({
        meta: { nextScrollId: null },
        schedules: [schedule(1, 1, '2026-11-20T19:00:00+01:00'), schedule(2, 2, '2026-11-21T20:00:00+01:00'), schedule(3, 3, '2026-11-22T20:00:00+01:00')],
        included: { events: [event(1, 'Koncert A'), event(2, 'Koncert B'), event(3, 'Koncert C')], venues: [venue(1, 'Klub', 49.59, 17.25), venue(2, 'Sál', 49.6, 17.26), venue(3, 'Bar', 49.58, 17.24)] },
      });
    }
    if (url.includes('kudyznudy.cz') && url.includes('mesto=500496')) return new Response('<title>Kalendář akcí ve městě Olomouc – Kudy z nudy</title><p>Trhy 28. 11.</p>');
    if (url.includes('kudyznudy.cz')) return new Response('<title>Kalendář akcí – Kudy z nudy</title>');
    return new Response('no', { status: 404 });
  }) as typeof fetch;
  const visits = createVisits(store, { ask: async () => kudyReply, fetch: fetcher, pause: async () => {}, now: () => NOW, timeZone: TIME_ZONE, home: PLACE });
  const labels = { get: (source: string) => VISIT_LABELS.find(([prefix]) => source.startsWith(prefix))?.[1] };
  const listing = (placeId: number) =>
    listEvents(store.upcoming('2026-11-13'), labels, NO_OPINIONS, { from: '2026-11-13', to: '2027-11-13', categories: [], freeOnly: false, place: visits.placeOf(placeId) });
  return { visits, requests, listing };
}

test('a city GoOut is not known for is found in its listing, read, and kept apart from home', async () => {
  const { visits, requests, listing } = setup(JSON.stringify([{ title: 'Vánoční trhy', startDate: '2026-11-28', category: 'Food and markets' }]));
  const visit = await visits.visit('  olomouc ');

  assert.deepEqual(visit.found, [
    { label: 'GoOut', count: 3, note: null },
    { label: 'Kudy z nudy', count: 1, note: null },
  ]);
  assert.deepEqual(visits.places(), [
    { id: 0, name: 'Brno', radiusKm: 30 },
    { id: visit.place.id, name: 'Olomouc', radiusKm: 30 },
  ]);
  assert.deepEqual(
    listing(visit.place.id).map((e) => [e.title, e.sources[0]?.label]),
    [
      ['Koncert A', 'GoOut'],
      ['Koncert B', 'GoOut'],
      ['Koncert C', 'GoOut'],
      ['Vánoční trhy', 'Kudy z nudy'],
    ],
  );
  assert.equal(listing(0).length, 0, 'none of it shows at home');
  assert.equal(visits.placeOf(999), null);

  const before = requests.length;
  await visits.visit('OLOMOUC');
  assert.equal(requests.slice(before).filter((url) => url.includes('countryIsos')).length, 0, 'the city number is remembered');
  assert.equal(visits.places().length, 2, 'a second look does not add a second place');
});

test('a featured city needs no lookup, and a city only one source covers still works', async () => {
  const { visits, requests } = setup();
  const praha = await visits.visit('Praha');
  assert.equal(requests.filter((url) => url.includes('countryIsos')).length, 0);
  assert.deepEqual(praha.found, [
    { label: 'GoOut', count: 3, note: null },
    { label: 'Kudy z nudy', count: 0, note: 'could not be read: its page for this city could not be confirmed' },
  ]);
});

test('nothing found says why, and home is not a visit', async () => {
  const { visits } = setup();
  await assert.rejects(visits.visit('Vídeň'), /nothing could be found for Vídeň: GoOut lists nothing for this city in the coming weeks; Kudy z nudy is read only for Czech regional capitals/);
  await assert.rejects(visits.visit('brno'), /Brno is home/);
  await assert.rejects(visits.visit(' '), /name a city/);
});
