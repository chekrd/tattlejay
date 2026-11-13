import type { When } from './contract.ts';
import { addDays, localDateTime } from './dates.ts';

export interface IcsEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url: string | null;
  lat: number | null;
  lon: number | null;
  when: When;
  cancelled: boolean;
  recurring: boolean;
}

interface Property {
  params: string;
  value: string;
}

const unescape = (value: string) => value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

const day = (compact: string) => `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;

// A calendar time is a UTC instant ("…Z"), a wall-clock time in a named zone, or a bare day. A wall-clock time is
// taken as it stands: every feed read here is local to the place it describes.
function moment(p: Property | undefined, timeZone: string): { date: string; time: string | null } | undefined {
  const m = p && /^(\d{8})(?:T(\d{2})(\d{2})\d{2}(Z)?)?$/.exec(p.value.trim());
  if (!m) return undefined;
  const [, date = '', hour, minute, utc] = m;
  if (hour === undefined || minute === undefined) return { date: day(date), time: null };
  if (!utc) return { date: day(date), time: `${hour}:${minute}` };
  const instant = new Date(`${day(date)}T${hour}:${minute}:00Z`);
  return Number.isNaN(instant.getTime()) ? undefined : localDateTime(instant, timeZone);
}

function when(start: Property | undefined, end: Property | undefined, timeZone: string): When | undefined {
  const from = moment(start, timeZone);
  if (!from) return undefined;
  const to = moment(end, timeZone);
  if (from.time === null) {
    // A whole-day event ends on the day before its DTEND.
    const last = to && to.time === null ? addDays(to.date, -1) : from.date;
    return { startDate: from.date, startTime: null, endDate: last > from.date ? last : from.date, endTime: null };
  }
  if (to?.time && to.date >= from.date) return { startDate: from.date, startTime: from.time, endDate: to.date, endTime: to.time };
  return { startDate: from.date, startTime: from.time, endDate: from.date, endTime: null };
}

export function parseIcs(text: string, timeZone: string): IcsEvent[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events: IcsEvent[] = [];
  let current: Map<string, Property> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = new Map();
    } else if (line === 'END:VEVENT') {
      if (current) {
        const text = (name: string) => unescape(current!.get(name)?.value ?? '').trim();
        const occurs = when(current.get('DTSTART'), current.get('DTEND'), timeZone);
        const geo = /^(-?[\d.]+);(-?[\d.]+)$/.exec(current.get('GEO')?.value.trim() ?? '');
        if (occurs && text('SUMMARY')) {
          events.push({
            uid: text('UID') || `${text('SUMMARY')} ${occurs.startDate}`,
            summary: text('SUMMARY'),
            description: text('DESCRIPTION'),
            location: text('LOCATION'),
            url: /^https?:\/\//.test(current.get('URL')?.value.trim() ?? '') ? current.get('URL')!.value.trim() : null,
            lat: geo ? Number(geo[1]) : null,
            lon: geo ? Number(geo[2]) : null,
            when: occurs,
            cancelled: text('STATUS').toUpperCase() === 'CANCELLED',
            recurring: current.has('RRULE'),
          });
        }
      }
      current = null;
    } else if (current) {
      const m = /^([A-Za-z-]+)((?:;[^:]*)?):(.*)$/.exec(line);
      if (m) current.set(m[1]!.toUpperCase(), { params: m[2] ?? '', value: m[3] ?? '' });
    }
  }
  return events;
}
