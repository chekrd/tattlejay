import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLACE, TIME_ZONE } from './config.ts';
import { openStore } from './db.ts';
import { listEvents, NO_OPINIONS } from './listing.ts';
import type { Picture } from './model.ts';
import { CAPTURED, createPages, pageSourceId } from './pages.ts';

const NOW = Date.parse('2026-11-13T09:00:00Z');
const found = (title: string, date: string, time: string | null = '19:00') => JSON.stringify([{ title, startDate: date, startTime: time, venue: 'Sál', category: 'Music', url: '/a' }]);

function setup(pagesByUrl: Record<string, string>, reply: (prompt: string, picture?: Picture) => string) {
  const store = openStore(':memory:');
  for (const seeded of store.pageSources()) store.removePageSource(seeded.id, pageSourceId(seeded.id));
  const asked: { prompt: string; picture: Picture | undefined }[] = [];
  const fetched: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetched.push(url);
    const body = pagesByUrl[url];
    return body === undefined ? new Response('gone', { status: 404 }) : new Response(body);
  }) as typeof fetch;
  const pages = createPages(store, {
    ask: async (prompt, _system, picture) => {
      asked.push({ prompt, picture });
      return reply(prompt, picture);
    },
    fetch: fetcher,
    now: () => NOW,
    timeZone: TIME_ZONE,
  });
  const listing = () =>
    listEvents(store.upcoming('2026-11-13'), new Map([[CAPTURED.id, CAPTURED.label]]), NO_OPINIONS, { from: '2026-11-13', to: '2027-11-13', categories: [], freeOnly: false, place: PLACE });
  const context = { fetch: fetcher, pause: async () => {}, today: '2026-11-13', place: PLACE };
  return { store, pages, asked, fetched, listing, context };
}

test('a page is previewed, added, and read by the model again only when its text changes', async () => {
  const site: Record<string, string> = { 'https://sal.test/program': '<title>Sál – program</title><p>20. 11. Koncert</p>' };
  const { pages, asked, listing, context } = setup(site, (prompt) => (prompt.includes('Jazz') ? found('Jazz', '2026-11-27') : found('Koncert', '2026-11-20')));

  const preview = await pages.preview(' https://sal.test/program ');
  assert.deepEqual(preview, {
    url: 'https://sal.test/program',
    label: 'Sál – program',
    method: 'model',
    events: [{ title: 'Koncert', when: { startDate: '2026-11-20', startTime: '19:00', endDate: '2026-11-20', endTime: null }, moreDates: 0, venue: 'Sál', address: null, category: 'Music', priceText: null, url: 'https://sal.test/a' }],
  });
  assert.equal(listing().length, 0, 'a preview adds nothing');

  await pages.add('https://sal.test/program', 'Sál');
  assert.equal(asked.length, 1, 'adding uses what the preview read');
  assert.deepEqual(listing().map((e) => e.title), ['Koncert']);
  await assert.rejects(pages.preview('https://sal.test/program'), /already a source/);

  const [source] = pages.sources();
  assert.deepEqual([source?.label, source?.home], ['Sál', 'https://sal.test/program']);
  assert.deepEqual((await source!.fetchItems(context)).items.map((i) => i.title), ['Koncert']);
  assert.equal(asked.length, 1, 'the page has not changed');

  site['https://sal.test/program'] = '<title>Sál – program</title><p>20. 11. Koncert</p><p>27. 11. Jazz</p>';
  assert.deepEqual((await source!.fetchItems(context)).items.map((i) => i.title), ['Jazz']);
  assert.equal(asked.length, 2);

  pages.remove(pages.pageIdOf(source!.id)!);
  assert.deepEqual([pages.sources().length, listing().length], [0, 0]);
});

test('a page with embedded events never reaches the model', async () => {
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@type': 'Event', name: 'Výstava', startDate: '2026-12-01' })}</script>`;
  const { pages, asked } = setup({ 'https://galerie.test/': `<title>Galerie</title>${ld}` }, () => '[]');
  const preview = await pages.preview('https://galerie.test/');
  assert.deepEqual([preview.method, preview.events.map((e) => e.title)], ['embedded', ['Výstava']]);
  assert.equal(asked.length, 0);
});

test('addresses that cannot be read are refused with a reason', async () => {
  const { pages } = setup({}, () => '[]');
  await assert.rejects(pages.preview('not a url'), /not a web address/);
  await assert.rejects(pages.preview('file:///etc/hosts'), /only http and https/);
  await assert.rejects(pages.preview('https://gone.test/'), /gone\.test answered 404/);
});

test('one event is captured from text, a link or a picture, and added only when confirmed', async () => {
  const { pages, asked, listing } = setup({ 'https://fb.test/events/1': '<title>Akce</title><p>Křest alba 5. 12. ve 20:00, Kabinet múz</p>' }, (_prompt, picture) =>
    picture ? found('Plakát', '2026-12-10', null) : found('Křest alba', '2026-12-05', '20:00'),
  );

  const fromText = await pages.capture({ text: 'Křest alba 5. 12. ve 20:00' });
  assert.equal(fromText.event.title, 'Křest alba');
  assert.match(asked[0]!.prompt, /pasted by a person[\s\S]*at most 1 events/);
  assert.equal(listing().length, 0);
  assert.equal(pages.addCapture(fromText.token), true);
  assert.equal(pages.addCapture(fromText.token), false, 'a token works once');

  const fromLink = await pages.capture({ url: 'https://fb.test/events/1' });
  assert.equal(fromLink.event.url, 'https://fb.test/a');

  const picture = { data: Buffer.from('png'), extension: 'png' };
  const fromPicture = await pages.capture({ picture });
  assert.equal(asked[2]!.picture, picture);
  assert.match(asked[2]!.prompt, /Read the image file capture\.png/);
  pages.addCapture(fromPicture.token);

  assert.deepEqual(listing().map((e) => [e.title, e.sources[0]?.label]), [
    ['Křest alba', 'Added by you'],
    ['Plakát', 'Added by you'],
  ]);
  await assert.rejects(pages.capture({}), /give a link, some text or a picture/);
});

test('a capture with nothing in it says so', async () => {
  const { pages } = setup({}, () => '[]');
  await assert.rejects(pages.capture({ text: 'hello' }), /no upcoming event could be read/);
});
