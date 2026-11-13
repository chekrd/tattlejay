import assert from 'node:assert/strict';
import { test } from 'node:test';
import { embeddedItems, pageText, parseFound } from './extract.ts';

const TODAY = '2026-11-13';

test('a page becomes readable text with link addresses kept', () => {
  const html = `<html><head><title>Program &ndash; Divadlo</title><meta name="description" content="Co hrajeme"><style>p{}</style></head><body>
    <nav><a href="/kontakt">Kontakt</a></nav>
    <script>var x = "<p>not text</p>";</script>
    <div><h2>Listopad</h2><p>14. 11. 19:00 <a href="/akce/rusalka">Rusalka</a></p><p>15.&nbsp;11. <a href="mailto:a@b.cz">napište</a> <a href="#top">nahoru</a></p></div>
    <footer>Adresa</footer></body></html>`;
  assert.deepEqual(pageText(html, 'https://divadlo.test/program/'), {
    title: 'Program – Divadlo',
    text: 'Co hrajeme\nListopad\n14. 11. 19:00 Rusalka ⟨https://divadlo.test/akce/rusalka⟩\n15. 11. napište nahoru',
  });
});

test('embedded events become items, grouped by title', () => {
  const event = (over: Record<string, unknown>) => ({
    '@type': 'MusicEvent',
    name: 'Koncert',
    startDate: '2026-11-20T19:00:00+01:00',
    location: { '@type': 'Place', name: 'Klub', address: { streetAddress: 'Ulice 1', addressLocality: 'Brno' }, geo: { latitude: 49.2, longitude: '16.6' } },
    offers: { price: '250', priceCurrency: 'czk' },
    url: '/koncert',
    ...over,
  });
  const html = [event({}), event({ startDate: '2026-11-27T20:00', offers: [] }), event({ name: 'Den otevřených dveří', '@type': 'Event', startDate: '2026-12-01', endDate: '2026-12-03', location: 'Radnice', offers: { price: 0 } }), event({ name: 'Stream', eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode' }), event({ name: 'Over', startDate: '2026-11-01' })]
    .map((e) => `<script type="application/ld+json">${JSON.stringify(e)}</script>`)
    .join('');
  assert.deepEqual(embeddedItems(html, 'https://klub.test/program', TODAY), [
    {
      key: 'koncert',
      title: 'Koncert',
      venue: 'Klub',
      address: 'Ulice 1, Brno',
      lat: 49.2,
      lon: 16.6,
      category: 'Music',
      tags: [],
      priceText: '250 Kč',
      isFree: false,
      url: 'https://klub.test/koncert',
      description: null,
      imageUrl: null,
      occurrences: [
        { startDate: '2026-11-20', startTime: '19:00', endDate: '2026-11-20', endTime: null },
        { startDate: '2026-11-27', startTime: '20:00', endDate: '2026-11-27', endTime: null },
      ],
    },
    {
      key: 'den otevrenych dveri',
      title: 'Den otevřených dveří',
      venue: null,
      address: null,
      lat: null,
      lon: null,
      category: 'Other',
      tags: [],
      priceText: 'Free',
      isFree: true,
      url: 'https://klub.test/koncert',
      description: null,
      imageUrl: null,
      occurrences: [{ startDate: '2026-12-01', startTime: null, endDate: '2026-12-03', endTime: null }],
    },
  ]);
});

test("the model's events are checked, resolved against the page and grouped", () => {
  const reply = `Here you go:
  [{"title":"Rusalka","startDate":"2026-11-14","startTime":"19:00","endDate":null,"endTime":null,"venue":"Janáčkovo divadlo","address":null,"category":"Theatre and dance","price":"od 340 Kč","free":false,"url":"/akce/rusalka"},
   {"title":"Rusalka","startDate":"2026-11-20","startTime":"7 pm","category":"Opera","url":null},
   {"title":"Den otevřených dveří","startDate":"2026-12-01","endDate":"2026-12-03","free":true},
   {"title":"Loni","startDate":"2025-12-01"},
   {"title":"Bez data","startDate":"brzy"}]`;
  const items = parseFound(reply, 'https://divadlo.test/program/', TODAY);
  assert.deepEqual(
    items.map((i) => [i.title, i.category, i.priceText, i.isFree, i.url, i.occurrences]),
    [
      [
        'Rusalka',
        'Theatre and dance',
        'od 340 Kč',
        false,
        'https://divadlo.test/akce/rusalka',
        [
          { startDate: '2026-11-14', startTime: '19:00', endDate: '2026-11-14', endTime: null },
          { startDate: '2026-11-20', startTime: null, endDate: '2026-11-20', endTime: null },
        ],
      ],
      ['Den otevřených dveří', 'Other', 'Free', true, 'https://divadlo.test/program/', [{ startDate: '2026-12-01', startTime: null, endDate: '2026-12-03', endTime: null }]],
    ],
  );
  assert.deepEqual(parseFound('[]', null, TODAY), []);
  assert.throws(() => parseFound('Sorry, no.', null, TODAY), /did not reply with a list/);
});
