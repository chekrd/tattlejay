import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import { CATEGORIES, type Category, RATING_VALUES, type RatingValue, type Rule, type When } from './contract.ts';
import type { SourceItem } from './sources/types.ts';

type Row = Record<string, SQLOutputValue>;

// Each step runs once, in order; `PRAGMA user_version` counts the steps a database has had. Only ever append.
const MIGRATIONS = [
  `
  CREATE TABLE event (
    id INTEGER PRIMARY KEY,
    first_seen_at INTEGER NOT NULL
  );
  CREATE TABLE record (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES event(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    venue TEXT,
    address TEXT,
    lat REAL,
    lon REAL,
    category TEXT NOT NULL,
    tags TEXT NOT NULL,
    price_text TEXT,
    is_free INTEGER,
    url TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    seen_at INTEGER NOT NULL,
    UNIQUE (source, key)
  );
  CREATE INDEX record_event ON record(event_id);
  CREATE INDEX record_place ON record(lat, lon);
  CREATE TABLE occurrence (
    record_id INTEGER NOT NULL REFERENCES record(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    start_time TEXT,
    end_date TEXT NOT NULL,
    end_time TEXT
  );
  CREATE INDEX occurrence_record ON occurrence(record_id);
  CREATE INDEX occurrence_end ON occurrence(end_date);
  CREATE TABLE source_state (
    source TEXT PRIMARY KEY,
    last_ok_at INTEGER,
    last_error TEXT,
    last_count INTEGER
  );
  `,
  // A rating keeps its own copy of what was rated: the event row goes when its source stops listing it, and the taste
  // profile is built from everything ever rated.
  `
  CREATE TABLE rating (
    event_id INTEGER PRIMARY KEY,
    value TEXT NOT NULL,
    at INTEGER NOT NULL,
    title TEXT NOT NULL,
    venue TEXT,
    category TEXT NOT NULL,
    tags TEXT NOT NULL
  );
  CREATE TABLE score (
    event_id INTEGER PRIMARY KEY REFERENCES event(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    reason TEXT NOT NULL,
    profile_version INTEGER NOT NULL
  );
  CREATE TABLE rule (
    id INTEGER PRIMARY KEY,
    text TEXT NOT NULL,
    verdict TEXT NOT NULL
  );
  CREATE TABLE setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // Pages added by address. `items` keeps what was last read off the page, to be reused while its text (`page_hash`)
  // stays the same. The first six are the listed sources that publish no structured data.
  `
  CREATE TABLE page_source (
    id INTEGER PRIMARY KEY,
    url TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    page_hash TEXT,
    items TEXT
  );
  INSERT INTO page_source (url, label) VALUES
    ('https://www.ndbrno.cz/program/', 'Národní divadlo Brno'),
    ('https://filharmonie-brno.cz/program/', 'Filharmonie Brno'),
    ('https://www.jic.cz/cz/akce', 'JIC'),
    ('https://www.muni.cz/kalendar', 'Masarykova univerzita'),
    ('https://rhkb.cz/sluzby/kalendar-akci', 'RHK Brno'),
    ('https://www.kudyznudy.cz/kalendar-akci?mesto=582786', 'Kudy z nudy');
  `,
];

function migrate(db: DatabaseSync) {
  const done = Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  for (let step = done; step < MIGRATIONS.length; step++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[step]!);
      db.exec(`PRAGMA user_version = ${step + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

const text = (v: SQLOutputValue | undefined) => (v == null ? null : String(v));
const number = (v: SQLOutputValue | undefined) => (v == null ? null : Number(v));
const category = (v: SQLOutputValue | undefined): Category => CATEGORIES.find((c) => c === v) ?? 'Other';

export interface StoredRecord {
  id: number;
  eventId: number;
  source: string;
  title: string;
  venue: string | null;
  address: string | null;
  lat: number | null;
  lon: number | null;
  category: Category;
  tags: string[];
  priceText: string | null;
  isFree: boolean | null;
  url: string;
  description: string | null;
  occurrences: When[];
}

export interface PageSource {
  id: number;
  url: string;
  label: string;
  pageHash: string | null;
  // JSON of the SourceItem list last read off the page.
  items: string | null;
}

export interface RatedEvent {
  value: RatingValue;
  title: string;
  venue: string | null;
  category: Category;
  tags: string[];
}

export interface Score {
  score: number;
  reason: string;
}

const tagList = (v: SQLOutputValue | undefined): string[] => {
  try {
    const parsed: unknown = JSON.parse(String(v ?? '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const ratingValue = (v: SQLOutputValue | undefined): RatingValue => RATING_VALUES.find((known) => known === v) ?? 'like';

export interface Neighbour {
  eventId: number;
  source: string;
  titleKey: string;
  lat: number;
  lon: number;
}

export interface SourceState {
  lastOkAt: number | null;
  lastError: string | null;
  lastCount: number | null;
}

export function openStore(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { timeout: 10_000 });
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);

  const recordOf = db.prepare('SELECT id, event_id FROM record WHERE source = ? AND key = ?');
  const neighbours = db.prepare(
    'SELECT event_id, source, title_key, lat, lon FROM record WHERE lat BETWEEN ? AND ? AND lon BETWEEN ? AND ?',
  );
  const sourcesOf = db.prepare('SELECT DISTINCT source FROM record WHERE event_id = ?');
  const spansOf = db.prepare(
    'SELECT o.start_date, o.start_time, o.end_date FROM occurrence o JOIN record r ON r.id = o.record_id WHERE r.event_id = ?',
  );
  const titled = db.prepare('SELECT event_id, source, lat FROM record WHERE title_key = ?');
  const placedVenues = db.prepare('SELECT venue, lat, lon FROM record WHERE venue IS NOT NULL AND lat IS NOT NULL AND lon IS NOT NULL GROUP BY venue');
  const createEvent = db.prepare('INSERT INTO event (first_seen_at) VALUES (?)');
  const saveRecord = db.prepare(`
    INSERT INTO record (event_id, source, key, title, title_key, venue, address, lat, lon, category, tags, price_text,
      is_free, url, description, image_url, seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, key) DO UPDATE SET
      title = excluded.title, title_key = excluded.title_key, venue = excluded.venue, address = excluded.address,
      lat = excluded.lat, lon = excluded.lon, category = excluded.category, tags = excluded.tags,
      price_text = excluded.price_text, is_free = excluded.is_free, url = excluded.url,
      description = excluded.description, image_url = excluded.image_url, seen_at = excluded.seen_at
    RETURNING id
  `);
  const clearOccurrences = db.prepare('DELETE FROM occurrence WHERE record_id = ?');
  const addOccurrence = db.prepare('INSERT INTO occurrence (record_id, start_date, start_time, end_date, end_time) VALUES (?, ?, ?, ?, ?)');
  const current = db.prepare(`
    SELECT r.id, r.key, MIN(o.start_date) AS next
    FROM record r JOIN occurrence o ON o.record_id = r.id
    WHERE r.source = ? AND o.end_date >= ?
    GROUP BY r.id
  `);
  const deleteRecord = db.prepare('DELETE FROM record WHERE id = ?');
  const upcoming = db.prepare(`
    SELECT r.id, r.event_id, r.source, r.title, r.venue, r.address, r.lat, r.lon, r.category, r.tags, r.price_text,
      r.is_free, r.url, r.description, o.start_date, o.start_time, o.end_date, o.end_time
    FROM record r JOIN occurrence o ON o.record_id = r.id
    WHERE o.end_date >= ?
    ORDER BY r.event_id, r.id
  `);
  const sourceState = db.prepare('SELECT last_ok_at, last_error, last_count FROM source_state WHERE source = ?');
  const setSourceState = db.prepare(`
    INSERT INTO source_state (source, last_ok_at, last_error, last_count) VALUES (?, ?, ?, ?)
    ON CONFLICT (source) DO UPDATE SET
      last_ok_at = excluded.last_ok_at, last_error = excluded.last_error, last_count = excluded.last_count
  `);

  const factsOf = db.prepare('SELECT title, venue, category, tags FROM record WHERE event_id = ? ORDER BY id');
  const upcomingIds = db.prepare(
    'SELECT DISTINCT r.event_id FROM record r JOIN occurrence o ON o.record_id = r.id WHERE o.end_date >= ?',
  );
  const ratings = db.prepare('SELECT event_id, value, title, venue, category, tags FROM rating ORDER BY at');
  const pageSources = db.prepare('SELECT id, url, label, page_hash, items FROM page_source ORDER BY id');
  const addPageSource = db.prepare('INSERT INTO page_source (url, label) VALUES (?, ?)');
  const keepPage = db.prepare('UPDATE page_source SET page_hash = ?, items = ? WHERE id = ?');
  const removePageSource = db.prepare('DELETE FROM page_source WHERE id = ?');
  const removeRecordsOf = db.prepare('DELETE FROM record WHERE source = ?');
  const removeStateOf = db.prepare('DELETE FROM source_state WHERE source = ?');
  const rate = db.prepare(`
    INSERT INTO rating (event_id, value, at, title, venue, category, tags) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (event_id) DO UPDATE SET value = excluded.value, at = excluded.at, title = excluded.title,
      venue = excluded.venue, category = excluded.category, tags = excluded.tags
  `);
  const unrate = db.prepare('DELETE FROM rating WHERE event_id = ?');
  const scores = db.prepare('SELECT event_id, score, reason FROM score WHERE profile_version = ?');
  const saveScore = db.prepare(`
    INSERT INTO score (event_id, score, reason, profile_version)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM event WHERE id = ?)
    ON CONFLICT (event_id) DO UPDATE SET score = excluded.score, reason = excluded.reason,
      profile_version = excluded.profile_version
  `);
  const rules = db.prepare('SELECT id, text, verdict FROM rule ORDER BY id');
  const addRule = db.prepare('INSERT INTO rule (text, verdict) VALUES (?, ?)');
  const removeRule = db.prepare('DELETE FROM rule WHERE id = ?');
  const setting = db.prepare('SELECT value FROM setting WHERE key = ?');
  const setSetting = db.prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value');

  return {
    pageSources(): PageSource[] {
      return pageSources.all().map((r) => ({ id: Number(r.id), url: String(r.url), label: String(r.label), pageHash: text(r.page_hash), items: text(r.items) }));
    },

    addPageSource: (url: string, label: string) => Number(addPageSource.run(url, label).lastInsertRowid),

    keepPage(id: number, pageHash: string, items: string) {
      keepPage.run(pageHash, items, id);
    },

    removePageSource(id: number, source: string) {
      removePageSource.run(id);
      removeStateOf.run(source);
      removeRecordsOf.run(source);
      db.exec('DELETE FROM event WHERE id NOT IN (SELECT event_id FROM record)');
    },

    factsOf(eventId: number) {
      return factsOf.all(eventId).map((r) => ({ title: String(r.title), venue: text(r.venue), category: category(r.category), tags: tagList(r.tags) }));
    },

    upcomingIds: (from: string) => upcomingIds.all(from).map((r) => Number(r.event_id)),

    ratings(): Map<number, RatedEvent> {
      return new Map(
        ratings.all().map((r) => [
          Number(r.event_id),
          { value: ratingValue(r.value), title: String(r.title), venue: text(r.venue), category: category(r.category), tags: tagList(r.tags) },
        ]),
      );
    },

    rate(eventId: number, rated: RatedEvent | null, now: number) {
      if (rated) rate.run(eventId, rated.value, now, rated.title, rated.venue, rated.category, JSON.stringify(rated.tags));
      else unrate.run(eventId);
    },

    scores(profileVersion: number): Map<number, Score> {
      return new Map(scores.all(profileVersion).map((r) => [Number(r.event_id), { score: Number(r.score), reason: String(r.reason) }]));
    },

    saveScore(eventId: number, score: Score, profileVersion: number) {
      saveScore.run(eventId, score.score, score.reason, profileVersion, eventId);
    },

    rules: (): Rule[] => rules.all().map((r) => ({ id: Number(r.id), text: String(r.text), verdict: r.verdict === 'never' ? 'never' : 'always' })),

    addRule: (text: string, verdict: Rule['verdict']) => Number(addRule.run(text, verdict).lastInsertRowid),

    removeRule(id: number) {
      removeRule.run(id);
    },

    setting: (key: string) => text(setting.get(key)?.value),

    setSetting(key: string, value: string) {
      setSetting.run(key, value);
    },

    transaction<T>(work: () => T): T {
      db.exec('BEGIN');
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    recordOf(source: string, key: string): { id: number; eventId: number } | undefined {
      const row = recordOf.get(source, key);
      return row && { id: Number(row.id), eventId: Number(row.event_id) };
    },

    neighbours(lat: number, lon: number, reachDeg: number): Neighbour[] {
      return neighbours.all(lat - reachDeg, lat + reachDeg, lon - reachDeg, lon + reachDeg).map((r) => ({
        eventId: Number(r.event_id),
        source: String(r.source),
        titleKey: String(r.title_key),
        lat: Number(r.lat),
        lon: Number(r.lon),
      }));
    },

    sourcesOf: (eventId: number) => sourcesOf.all(eventId).map((r) => String(r.source)),

    spansOf: (eventId: number) =>
      spansOf.all(eventId).map((r) => ({ startDate: String(r.start_date), startTime: text(r.start_time), endDate: String(r.end_date) })),

    placedVenues: () => placedVenues.all().map((r) => ({ venue: String(r.venue), lat: Number(r.lat), lon: Number(r.lon) })),

    titled: (titleKey: string) => titled.all(titleKey).map((r) => ({ eventId: Number(r.event_id), source: String(r.source), placed: r.lat !== null })),

    createEvent: (now: number) => Number(createEvent.run(now).lastInsertRowid),

    saveRecord(eventId: number, source: string, item: SourceItem, titleKey: string, now: number) {
      const row = saveRecord.get(
        eventId,
        source,
        item.key,
        item.title,
        titleKey,
        item.venue,
        item.address,
        item.lat,
        item.lon,
        item.category,
        JSON.stringify(item.tags),
        item.priceText,
        item.isFree === null ? null : Number(item.isFree),
        item.url,
        item.description,
        item.imageUrl,
        now,
      );
      const id = Number(row?.id);
      clearOccurrences.run(id);
      for (const o of item.occurrences) addOccurrence.run(id, o.startDate, o.startTime, o.endDate, o.endTime);
    },

    // Drops what the source no longer lists: records with a date still ahead that were not in this read and fall
    // inside the window the read covered. Records whose dates have all passed stay as history.
    removeMissing(source: string, seen: Set<string>, today: string, coveredUntil: string | null): number {
      let removed = 0;
      for (const row of current.all(source, today)) {
        if (seen.has(String(row.key))) continue;
        if (coveredUntil !== null && String(row.next) >= coveredUntil) continue;
        deleteRecord.run(Number(row.id));
        removed++;
      }
      if (removed) db.exec('DELETE FROM event WHERE id NOT IN (SELECT event_id FROM record)');
      return removed;
    },

    upcoming(from: string): StoredRecord[] {
      const records: StoredRecord[] = [];
      let last: StoredRecord | undefined;
      for (const r of upcoming.all(from) as Row[]) {
        const id = Number(r.id);
        if (last?.id !== id) {
          last = {
            id,
            eventId: Number(r.event_id),
            source: String(r.source),
            title: String(r.title),
            venue: text(r.venue),
            address: text(r.address),
            lat: number(r.lat),
            lon: number(r.lon),
            category: category(r.category),
            tags: tagList(r.tags),
            priceText: text(r.price_text),
            isFree: r.is_free == null ? null : Number(r.is_free) === 1,
            url: String(r.url),
            description: text(r.description),
            occurrences: [],
          };
          records.push(last);
        }
        last.occurrences.push({
          startDate: String(r.start_date),
          startTime: text(r.start_time),
          endDate: String(r.end_date),
          endTime: text(r.end_time),
        });
      }
      return records;
    },

    sourceState(source: string): SourceState {
      const row = sourceState.get(source);
      return { lastOkAt: number(row?.last_ok_at), lastError: text(row?.last_error), lastCount: number(row?.last_count) };
    },

    setSourceState(source: string, state: SourceState) {
      setSourceState.run(source, state.lastOkAt, state.lastError, state.lastCount);
    },

    close: () => db.close(),
  };
}

export type Store = ReturnType<typeof openStore>;
