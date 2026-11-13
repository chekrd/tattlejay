import type { EventView } from './contract.ts';
import { addDays } from './dates.ts';

const compact = (date: string) => date.replaceAll('-', '');
const stamp = (date: string, time: string) => `${compact(date)}T${time.replace(':', '')}00`;
const escape = (text: string) => text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

function addHours(date: string, time: string, hours: number): { date: string; time: string } {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const total = h + hours;
  return { date: addDays(date, Math.floor(total / 24)), time: `${String(total % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}` };
}

// One calendar entry for the date the listing shows. Feeds rarely give an end time, so a timed event without one is
// entered as two hours long.
export function toIcs(event: EventView, timeZone: string, now: number): string {
  const { when } = event;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//tattlejay//EN',
    'BEGIN:VEVENT',
    `UID:event-${event.id}-${compact(when.startDate)}@tattlejay`,
    `DTSTAMP:${new Date(now).toISOString().replace(/[-:]|\.\d+/g, '')}`,
    `SUMMARY:${escape(event.title)}`,
  ];
  if (when.startTime === null) {
    lines.push(`DTSTART;VALUE=DATE:${compact(when.startDate)}`, `DTEND;VALUE=DATE:${compact(addDays(when.endDate, 1))}`);
  } else {
    const end = when.endTime ? { date: when.endDate, time: when.endTime } : addHours(when.startDate, when.startTime, 2);
    lines.push(`DTSTART;TZID=${timeZone}:${stamp(when.startDate, when.startTime)}`, `DTEND;TZID=${timeZone}:${stamp(end.date, end.time)}`);
  }
  const place = [event.venue, event.address].filter(Boolean).join(', ');
  if (place) lines.push(`LOCATION:${escape(place)}`);
  const url = event.sources[0]?.url;
  if (url) lines.push(`URL:${url}`, `DESCRIPTION:${escape(url)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
