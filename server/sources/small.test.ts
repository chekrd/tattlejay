import assert from 'node:assert/strict';
import { test } from 'node:test';
import { brnoAiItems } from './brnoAi.ts';
import { calendarItems } from './calendars.ts';
import { kinoArtItems, scalaItems } from './cinemas.ts';
import { expatItems } from './expat.ts';
import { impactHubItems } from './impactHub.ts';
import { mdbItems } from './mdb.ts';
import { meetupItems, meetupOnlineItems } from './meetup.ts';

const TODAY = '2026-11-13';
const ld = (...events: unknown[]) => events.map((e) => `<script type="application/ld+json">${JSON.stringify(e)}</script>`).join('\n');
const brief = (items: { title: string; venue: string | null; occurrences: unknown[] }[]) => items.map((i) => [i.title, i.venue, i.occurrences]);
const at = (startDate: string, startTime: string | null, endTime: string | null = null, endDate = startDate) => ({ startDate, startTime, endDate, endTime });

test('Scala: one film with its showtimes, past ones dropped', () => {
  const screening = (name: string, startDate: string, id: number) => ({ '@type': 'Event', name, startDate, url: `https://www.kinoscala.cz/?projection=${id}` });
  const items = scalaItems(
    ld(screening('Fjord', '2026-11-16T16:45:00+01:00', 3), screening('Fjord', '2026-11-13T20:00:00+01:00', 2), screening('Fjord', '2026-11-12T20:00:00+01:00', 1), screening('Uvid&iacute;š všechno', '2026-11-14T18:00:00+01:00', 4)),
    TODAY,
  );
  assert.deepEqual(brief(items), [
    ['Fjord', 'Univerzitní kino Scala', [at('2026-11-13', '20:00'), at('2026-11-16', '16:45')]],
    ['Uvidíš všechno', 'Univerzitní kino Scala', [at('2026-11-14', '18:00')]],
  ]);
  assert.equal(items[0]?.url, 'https://www.kinoscala.cz/?projection=2');
  assert.equal(items[0]?.category, 'Film');
});

test('Kino Art: film, day and time come from the screening address, the title from its link', () => {
  const link = (path: string, inner: string) => `<a class="x" href="https://www.kinoart.cz/cs/program/${path}">${inner}</a>`;
  const html = [
    link('arco-titulky/2026/11/22/1545', '<img src="poster.jpg" />'),
    link('arco-titulky/2026/11/22/1545', '15:45'),
    link('arco-titulky/2026/11/22/1545', ' Arco | titulky '),
    link('arco-titulky/2026/11/25/2000', 'více...'),
    link('arco-titulky/2026/11/22/1545/vstupenky', 'Vstupenky'),
    link('duna/2026/11/10/1600', 'Duna'),
  ].join('\n');
  const items = kinoArtItems(html, TODAY);
  assert.deepEqual(brief(items), [['Arco | titulky', 'Kino Art', [at('2026-11-22', '15:45'), at('2026-11-25', '20:00')]]]);
  assert.equal(items[0]?.url, 'https://www.kinoart.cz/cs/program/arco-titulky/2026/11/22/1545');
});

test('Brno.AI: in-person events in or by Brno and online ones, with midnight read as a day', () => {
  const event = (name: string, startDate: string, endDate: string, place: string, mode = 'Offline') => ({
    '@type': 'Event',
    name,
    startDate,
    endDate,
    eventAttendanceMode: `https://schema.org/${mode}EventAttendanceMode`,
    location: { '@type': 'Place', name: place, address: place },
    url: 'https://example.test/',
  });
  const html = ld({
    '@graph': [
      event('Conference', '2027-05-12T22:00:00.000Z', '2027-05-14T22:00:00.000Z', 'Brno'),
      event('Talk', '2026-11-20T16:00:00.000Z', '2026-11-20T18:00:00.000Z', 'Hotel Continental Brno, Kounicova 680/6, Brno'),
      event('Factory visit', '2026-11-21T08:30:00.000Z', '2026-11-21T12:00:00.000Z', 'Blanenská 1288/27, Kuřim'),
      event('WebExpo', '2027-05-25T22:00:00.000Z', '2027-05-28T22:00:00.000Z', 'Palace Lucerna, Praha'),
      event('Webinar', '2026-11-20T16:00:00.000Z', '2026-11-20T18:00:00.000Z', 'Brno', 'Online'),
      event('Over', '2026-11-01T16:00:00.000Z', '2026-11-01T18:00:00.000Z', 'Brno'),
    ],
  });
  assert.deepEqual(brief(brnoAiItems(html, TODAY)), [
    ['Conference', null, [at('2027-05-13', null, null, '2027-05-14')]],
    ['Talk', 'Hotel Continental Brno', [at('2026-11-20', '17:00', '19:00')]],
    ['Factory visit', 'Blanenská 1288/27', [at('2026-11-21', '09:30', '13:00')]],
    ['Webinar', null, [at('2026-11-20', '17:00', '19:00')]],
  ]);
  assert.deepEqual(
    brnoAiItems(html, TODAY).map((i) => [i.title, i.online, i.address]),
    [
      ['Conference', false, 'Brno'],
      ['Talk', false, 'Kounicova 680/6, Brno'],
      ['Factory visit', false, 'Kuřim'],
      ['Webinar', true, null],
    ],
  );
});

test('Meetup: upcoming and just-past events with a venue in the city, and online ones', () => {
  const event = (id: string, title: string, dateTime: string, venue: string | null, eventType = 'PHYSICAL') => ({
    __typename: 'Event',
    id,
    title,
    eventUrl: `https://www.meetup.com/g/events/${id}/`,
    dateTime,
    endTime: dateTime.replace('T18', 'T21'),
    eventType,
    venue: venue ? { __ref: venue } : null,
  });
  const state = {
    'Venue:1': { __typename: 'Venue', name: 'Restarace U Lucerny', address: 'Veveří 20', city: 'Brno' },
    'Venue:2': { __typename: 'Venue', name: 'Alma Career', address: 'Pribinova 19', city: 'Bratislava' },
    'Venue:3': { __typename: 'Venue', name: 'Music Lab', address: 'Opletalova 1, Brno-město', city: 'Brno-město' },
    'Event:1': event('1', 'AI 4 DEV @ Brno', '2026-11-18T18:00:00+01:00', 'Venue:1'),
    'Event:2': event('2', 'AI 4 DEV @ Bratislava', '2026-11-18T18:00:00+01:00', 'Venue:2'),
    'Event:3': event('3', 'Old', '2026-08-12T18:00:00+02:00', 'Venue:1'),
    'Event:4': event('4', 'Online', '2026-11-19T18:00:00+01:00', null, 'ONLINE'),
    'Event:5': event('5', 'Frontendisti', '2026-11-20T18:00:00+01:00', 'Venue:3'),
    'Event:6': event('6', 'Last week', '2026-11-10T18:00:00+01:00', 'Venue:1'),
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { __APOLLO_STATE__: state } } })}</script>`;
  const items = meetupItems(html, TODAY, 'Brno');
  assert.deepEqual(brief(items), [
    ['AI 4 DEV @ Brno', 'Restarace U Lucerny', [at('2026-11-18', '18:00', '21:00')]],
    ['Online', null, [at('2026-11-19', '18:00', '21:00')]],
    ['Frontendisti', 'Music Lab', [at('2026-11-20', '18:00', '21:00')]],
    ['Last week', 'Restarace U Lucerny', [at('2026-11-10', '18:00', '21:00')]],
  ]);
  assert.deepEqual(items.map((i) => [i.address, i.online ?? false]), [
    ['Veveří 20, Brno', false],
    [null, true],
    ['Opletalova 1, Brno-město', false],
    ['Veveří 20, Brno', false],
  ]);
  assert.throws(() => meetupItems('<html>blocked</html>', TODAY, 'Brno'), /no event data/);
});

test('Expat Centre: the day and times come from the description', () => {
  const xml = `<rss><channel><title>Events</title>
    <item><title>&quot;Welcome&quot;: Královo Pole</title><link>https://x.test/a/</link><guid>https://x.test/a/</guid>
      <pubDate>Sat, 14 Nov 2026 09:00:00 +0000</pubDate><description><![CDATA[14/11/2026 - 10:00 - 12:00 <br/>#_LOCATIONNAME]]></description></item>
    <item><title>Past</title><link>https://x.test/b/</link><pubDate>Sat, 07 Nov 2026 09:00:00 +0000</pubDate><description><![CDATA[07/11/2026 - 10:00 - 12:00]]></description></item>
    <item><title>No times</title><link>https://x.test/c/</link><pubDate>Mon, 16 Nov 2026 17:30:00 +0000</pubDate><description><![CDATA[see website]]></description></item>
  </channel></rss>`;
  assert.deepEqual(brief(expatItems(xml, TODAY)), [
    ['"Welcome": Královo Pole', null, [at('2026-11-14', '10:00', '12:00')]],
    ['No times', null, [at('2026-11-16', '18:30')]],
  ]);
});

test('Impact Hub: local times, prices, and virtual events as online', () => {
  const event = (over: Record<string, unknown>) => ({ id: 1, title: 'Talk &#8211; live', url: 'https://impacthub.cz/kalendar/talk/', start_date: '2026-11-18 17:30:00', end_date: '2026-11-18 19:00:00', all_day: false, cost: 'Zdarma', is_virtual: false, ...over });
  const items = impactHubItems([event({}), event({ id: 2, cost: '590 Kč -  Kč' }), event({ id: 3, is_virtual: true }), event({ id: 4, all_day: true, cost: '' }), { broken: true }]);
  assert.deepEqual(
    items.map((i) => [i.key, i.title, i.priceText, i.isFree, i.occurrences[0]]),
    [
      ['1', 'Talk – live', 'Zdarma', true, at('2026-11-18', '17:30', '19:00')],
      ['2', 'Talk – live', '590 Kč', false, at('2026-11-18', '17:30', '19:00')],
      ['3', 'Talk – live', 'Zdarma', true, at('2026-11-18', '17:30', '19:00')],
      ['4', 'Talk – live', null, null, at('2026-11-18', null)],
    ],
  );
  assert.deepEqual(items.map((i) => [i.venue, i.online]), [
    ['Impact Hub Brno', false],
    ['Impact Hub Brno', false],
    [null, true],
    ['Impact Hub Brno', false],
  ]);
});

test('Městské divadlo: one production with its performances', () => {
  const performance = (title: string, start: string, over: Record<string, unknown> = {}) => ({ start, canceled: false, private: false, stage: { title: 'Hudební scéna' }, production: { title, url: `/cs/inscenace/${title.toLowerCase()}`, genre: 'Musical' }, ...over });
  const items = mdbItems([performance('Bídníci', '2026-11-14T18:00:00+01:00'), performance('Bídníci', '2026-11-13T18:00:00+01:00'), performance('Bídníci', '2026-11-15T18:00:00+01:00', { canceled: true }), performance('Prachy', '2026-11-17T19:00:00+01:00', { private: true })]);
  assert.deepEqual(brief(items), [['Bídníci', 'Městské divadlo Brno', [at('2026-11-13', '18:00'), at('2026-11-14', '18:00')]]]);
  assert.equal(items[0]?.url, 'https://www.mdb.cz/cs/inscenace/b%C3%ADdn%C3%ADci');
  assert.deepEqual(items[0]?.tags, ['Musical', 'Hudební scéna']);
});

test('calendar feeds: upcoming events, the place they name or the default, and a usable link', () => {
  const ics = ['BEGIN:VCALENDAR']
    .concat(
      ['SUMMARY:rust meetup', 'UID:1', 'DTSTART;TZID=Europe/Prague:20261119T180000', 'LOCATION:base48', 'DESCRIPTION:Details at https://base48.cz/rust and more'],
      ['SUMMARY:Council meeting', 'UID:2', 'DTSTART;TZID=Europe/Prague:20261124T180000'],
      ['SUMMARY:Tech Execs Meetup', 'UID:3', 'DTSTART:20261208T170000Z', 'LOCATION:https://luma.com/abc', 'GEO:49.19;16.62'],
      ['SUMMARY:Welding', 'UID:4', 'DTSTART;TZID=Europe/Prague:20261010T100000'],
      ['SUMMARY:Pyvo', 'UID:5', 'DTSTART:20261126T180000Z', 'LOCATION:ArtBar Druhý Pád\\, Štefánikova 836/1\\, Brno', 'URL:https://pyvo.cz/brno-pyvo/2026-11/'],
    )
    .join('\n')
    .replace(/^SUMMARY/gm, 'BEGIN:VEVENT\nSUMMARY')
    .replace(/\n(?=BEGIN:VEVENT)/g, '\nEND:VEVENT\n')
    .concat('\nEND:VEVENT\nEND:VCALENDAR')
    .replace('BEGIN:VCALENDAR\nEND:VEVENT\n', 'BEGIN:VCALENDAR\n');
  const items = calendarItems(
    ics,
    { home: 'https://home.test/', category: 'Tech and meetups', venue: { venue: 'Base48 hackerspace', address: 'Brno', lat: null, lon: null }, skip: (e) => /council/i.test(e.summary) },
    TODAY,
  );
  assert.deepEqual(
    items.map((i) => [i.title, i.venue, i.address, i.lat, i.url]),
    [
      ['rust meetup', 'base48', null, null, 'https://base48.cz/rust'],
      ['Tech Execs Meetup', 'Base48 hackerspace', 'Brno', 49.19, 'https://luma.com/abc'],
      ['Pyvo', 'ArtBar Druhý Pád', 'Štefánikova 836/1, Brno', null, 'https://pyvo.cz/brno-pyvo/2026-11/'],
    ],
  );
});

test('Meetup search: online events only, with their host and the topic asked for', () => {
  const event = (id: string, title: string, dateTime: string, eventType: string, over: Record<string, unknown> = {}) => ({
    __typename: 'Event',
    id,
    title,
    eventUrl: `https://www.meetup.com/g/events/${id}/`,
    dateTime,
    eventType,
    description: 'Talk about agents.',
    feeSettings: null,
    group: { __ref: 'Group:1' },
    ...over,
  });
  const state = {
    'Group:1': { __typename: 'Group', name: 'Baig Academy of AI' },
    'Event:1': event('1', 'Build AI Agents', '2026-11-19T12:00:00-05:00', 'ONLINE'),
    'Event:2': event('2', 'In person in Kraków', '2026-11-26T18:00:00+01:00', 'PHYSICAL'),
    'Event:3': event('3', 'Paid workshop', '2026-11-20T18:00:00+01:00', 'ONLINE', { feeSettings: { amount: 10 }, group: null, description: null, venue: { __typename: 'Venue', name: 'Online event', address: '', city: '' } }),
    'Event:5': event('5', 'Inline host', '2026-11-21T18:00:00+01:00', 'ONLINE', { group: { __typename: 'Group', name: 'Founders Amsterdam' }, description: null }),
    'Event:6': { __typename: 'Event', id: '6', dateTime: '2026-11-25T18:00:00+01:00', group: { __typename: 'Group', urlname: 'x' } },
    'Event:4': event('4', 'Long gone', '2026-10-01T18:00:00+02:00', 'ONLINE'),
  };
  const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { __APOLLO_STATE__: state } } })}</script>`;
  const items = meetupOnlineItems(html, TODAY, 'Technology', 'Tech and meetups');
  assert.deepEqual(
    items.map((i) => [i.key, i.title, i.online, i.category, i.tags, i.isFree, i.description, i.occurrences[0]]),
    [
      ['1', 'Build AI Agents', true, 'Tech and meetups', ['Technology', 'Baig Academy of AI'], true, 'Hosted by Baig Academy of AI. Talk about agents.', at('2026-11-19', '18:00')],
      ['3', 'Paid workshop', true, 'Tech and meetups', ['Technology'], false, null, at('2026-11-20', '18:00')],
      ['5', 'Inline host', true, 'Tech and meetups', ['Technology', 'Founders Amsterdam'], true, 'Hosted by Founders Amsterdam.', at('2026-11-21', '18:00')],
    ],
  );
});
