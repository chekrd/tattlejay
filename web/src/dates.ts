import type { When } from '../../server/contract.ts';

export type Preset = 'today' | 'weekend' | 'week' | 'range';

export interface Range {
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// The weekend starts on Friday, when most evening events of a weekend begin.
export function presetRange(preset: Exclude<Preset, 'range'>, today: string): Range {
  if (preset === 'today') return { from: today, to: today };
  if (preset === 'week') return { from: today, to: addDays(today, 6) };
  const weekday = utc(today).getUTCDay();
  if (weekday === 0) return { from: today, to: today };
  const from = weekday >= 5 ? today : addDays(today, 5 - weekday);
  return { from, to: addDays(today, 7 - weekday) };
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function dayLabel(date: string, today: string): string {
  const parts: Record<string, string> = {};
  for (const p of dayFormat.formatToParts(utc(date))) parts[p.type] = p.value;
  const year = date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${parts.year}`;
  const label = `${parts.weekday} ${parts.day} ${parts.month}${year}`;
  if (date === today) return `Today · ${label}`;
  if (date === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

const shortDay = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function timeLabel(when: When): string {
  if (when.startTime === null) return when.endDate > when.startDate ? `until ${shortDay.format(utc(when.endDate))}` : 'All day';
  return when.endTime && when.endDate === when.startDate ? `${when.startTime}–${when.endTime}` : when.startTime;
}

export function agoLabel(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}
