import { homedir } from 'node:os';
import { join } from 'node:path';

export const PORT = Number(process.env.TATTLEJAY_PORT ?? 7440);
export const HOST = '127.0.0.1';

export const ROOT = join(import.meta.dirname, '..');
export const DATA_DIR = process.env.TATTLEJAY_DATA_DIR ?? join(homedir(), 'Library', 'Application Support', 'tattlejay');
export const DB_PATH = join(DATA_DIR, 'tattlejay.db');
export const WEB_DIST = process.env.TATTLEJAY_WEB_DIST ?? join(ROOT, 'web', 'dist');

export const TIME_ZONE = 'Europe/Prague';

export interface Place {
  name: string;
  lat: number;
  lon: number;
  radiusKm: number;
  gooutCityId: number;
  // As Meetup's search addresses a city.
  meetupLocation: string;
}

export const PLACE: Place = { name: 'Brno', lat: 49.1951, lon: 16.6068, radiusKm: 30, gooutCityId: 101748109, meetupLocation: 'cz--Brno' };

export const POLL_EVERY_MS = 20 * 3_600_000;

export const CLAUDE_COMMAND = process.env.TATTLEJAY_CLAUDE ?? 'claude';
export const CLAUDE_MODEL = process.env.TATTLEJAY_MODEL ?? 'sonnet';
export const CLAUDE_CWD = join(DATA_DIR, 'model');
export const CLAUDE_TIMEOUT_MS = 180_000;

// Outside services get no project or personal name.
export const USER_AGENT = 'Mozilla/5.0 (compatible; events-reader/0.1)';
