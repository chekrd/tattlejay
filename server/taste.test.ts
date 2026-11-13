import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TIME_ZONE } from './config.ts';
import { openStore } from './db.ts';
import { ingest } from './ingest.ts';
import type { SourceItem } from './sources/types.ts';
import { createTaste, parseScores } from './taste.ts';

const NOW = Date.parse('2026-11-13T09:00:00Z');

const item = (key: string, title: string, over: Partial<SourceItem> = {}): SourceItem => ({
  key,
  title,
  venue: 'Fléda',
  address: null,
  lat: 49.2 + Number(key) / 100,
  lon: 16.6,
  category: 'Music',
  tags: ['punk'],
  priceText: '200 Kč',
  isFree: false,
  url: `https://example.test/${key}`,
  description: null,
  imageUrl: null,
  occurrences: [{ startDate: '2026-11-20', startTime: '20:00', endDate: '2026-11-20', endTime: null }],
  ...over,
});

function setup(reply: (prompt: string, system: string) => string | Promise<string>) {
  const store = openStore(':memory:');
  ingest(store, 'goout', { items: [item('1', 'Punk night'), item('2', 'Rusalka', { venue: 'Janáčkovo divadlo', category: 'Theatre and dance', tags: ['play_opera'] })], coveredUntil: null }, { today: '2026-11-13', now: NOW });
  const calls: { prompt: string; system: string }[] = [];
  const taste = createTaste(store, {
    ask: async (prompt, system) => {
      calls.push({ prompt, system });
      return reply(prompt, system);
    },
    now: () => NOW,
    timeZone: TIME_ZONE,
  });
  const ids = store.upcomingIds('2026-11-13');
  return { store, taste, calls, ids };
}

const scoreAll = (prompt: string) =>
  JSON.stringify(
    [...prompt.matchAll(/^(\d+) \| /gm)].map((m) => ({ id: Number(m[1]), score: 80, reason: 'You like punk.' })),
  );

test('reads scores out of a reply, with or without wrapping', () => {
  assert.deepEqual(
    [...parseScores('```json\n[{"id": 1, "score": 120.4, "reason": " Loud. "}, {"id": "2", "score": -5, "reason": "No."}]\n```')],
    [
      [1, { score: 100, reason: 'Loud.' }],
      [2, { score: 0, reason: 'No.' }],
    ],
  );
  assert.throws(() => parseScores('I cannot help with that.'), /did not reply with a list/);
  assert.throws(() => parseScores('[{"id": 1,]'), /could not be read/);
});

test('with nothing to go on, the model is not called', async () => {
  const { taste, calls } = setup(() => 'unused');
  await taste.run();
  assert.equal(calls.length, 0);
  assert.deepEqual(taste.status(), { ready: false, running: false, progress: null, stale: false, lastRunAt: NOW, error: null });
  assert.equal(taste.due(), true);
});

test('builds a profile from words and ratings, then scores what is upcoming', async () => {
  const { store, taste, calls, ids } = setup((prompt, system) => (system.startsWith('You maintain') ? ' You like loud punk nights. ' : scoreAll(prompt)));
  taste.setSeed('I like punk and small clubs.');
  assert.equal(taste.rate(ids[1]!, 'dislike'), true);
  assert.equal(taste.rate(999, 'like'), false);
  assert.equal(taste.status().stale, true);

  await taste.run();

  assert.equal(calls.length, 2);
  assert.match(calls[0]!.prompt, /I like punk and small clubs\./);
  assert.match(calls[0]!.prompt, /disliked \| Rusalka \| Janáčkovo divadlo \| Theatre and dance \| play_opera/);
  assert.match(calls[1]!.prompt, /^Profile:\nYou like loud punk nights\.\n/);
  assert.match(calls[1]!.prompt, /\d+ \| Punk night \| Fléda \| Music \| punk \| 200 Kč \| -/);
  assert.equal(taste.taste().profile, 'You like loud punk nights.');
  assert.equal(store.scores(taste.profileVersion()).size, 2);
  assert.deepEqual(taste.status(), { ready: true, running: false, progress: null, stale: false, lastRunAt: NOW, error: null });
  assert.equal(taste.due(), false);

  await taste.run();
  assert.equal(calls.length, 2, 'nothing changed, so nothing is asked again');
});

test('a new rating rebuilds the profile and re-scores; an edit only re-scores', async () => {
  const { taste, calls, ids } = setup((prompt, system) => (system.startsWith('You maintain') ? `Profile ${Math.random()}` : scoreAll(prompt)));
  taste.setSeed('Punk.');
  await taste.run();
  assert.equal(calls.length, 2);

  taste.rate(ids[0]!, 'save');
  assert.equal(taste.status().stale, true);
  await taste.run();
  assert.equal(calls.length, 4);
  assert.match(calls[2]!.prompt, /saved \| Punk night/);

  taste.editProfile('You only like jazz.');
  assert.equal(taste.status().stale, true);
  await taste.run();
  assert.equal(calls.length, 5);
  assert.match(calls[4]!.prompt, /^Profile:\nYou only like jazz\./);
  assert.equal(taste.taste().profile, 'You only like jazz.');
});

test('a failing model leaves the error to show and the day still due', async () => {
  const { taste } = setup(() => {
    throw new Error('the Claude CLI reported an error: Not logged in');
  });
  taste.setSeed('Punk.');
  await taste.run();
  assert.equal(taste.status().error, 'the Claude CLI reported an error: Not logged in');
  assert.equal(taste.status().ready, false);
  assert.equal(taste.due(), true);
});

test('unrating changes the inputs too', async () => {
  const { store, taste, ids } = setup((prompt, system) => (system.startsWith('You maintain') ? 'P' : scoreAll(prompt)));
  taste.rate(ids[0]!, 'like');
  await taste.run();
  taste.rate(ids[0]!, null);
  assert.equal(store.ratings().size, 0);
  assert.equal(taste.status().stale, false, 'no words and no ratings left: nothing to rebuild from');
});

test('history keeps what was rated, latest first, and outlives the event itself', async () => {
  let now = NOW;
  const store = openStore(':memory:');
  ingest(store, 'goout', { items: [item('1', 'Punk night'), item('2', 'Rusalka', { venue: 'Janáčkovo divadlo', category: 'Theatre and dance' })], coveredUntil: null }, { today: '2026-11-13', now: NOW });
  const taste = createTaste(store, { ask: async () => 'unused', now: () => now, timeZone: TIME_ZONE });
  const [punk, rusalka] = store.upcomingIds('2026-11-13');

  taste.rate(punk!, 'like');
  now += 60_000;
  taste.rate(rusalka!, 'dislike');
  assert.deepEqual(taste.history(), [
    { eventId: rusalka, value: 'dislike', at: NOW + 60_000, title: 'Rusalka', venue: 'Janáčkovo divadlo', category: 'Theatre and dance', eventDate: '2026-11-20', url: 'https://example.test/2' },
    { eventId: punk, value: 'like', at: NOW, title: 'Punk night', venue: 'Fléda', category: 'Music', eventDate: '2026-11-20', url: 'https://example.test/1' },
  ]);

  // The source drops the event while it is still ahead, so its rows go.
  ingest(store, 'goout', { items: [item('2', 'Rusalka')], coveredUntil: null }, { today: '2026-11-13', now });
  assert.deepEqual(store.factsOf(punk!), []);
  now += 60_000;
  assert.equal(taste.rate(punk!, 'save'), true);
  assert.deepEqual(taste.history().map((e) => [e.title, e.value, e.eventDate]), [
    ['Punk night', 'save', '2026-11-20'],
    ['Rusalka', 'dislike', '2026-11-20'],
  ]);
  taste.rate(punk!, null);
  assert.deepEqual(taste.history().map((e) => e.title), ['Rusalka']);
  assert.equal(taste.rate(punk!, 'like'), false, 'nothing is left to rate');
});
