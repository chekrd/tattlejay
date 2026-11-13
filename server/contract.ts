export const CATEGORIES = [
  'Music',
  'Theatre and dance',
  'Film',
  'Exhibitions',
  'Talks and lectures',
  'Tech and meetups',
  'Business and networking',
  'Family and kids',
  'Sport',
  'Food and markets',
  'Festivals',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

// Dates are local calendar days (YYYY-MM-DD) and times local wall time (HH:MM) at the event's place.
export interface When {
  startDate: string;
  startTime: string | null;
  endDate: string;
  endTime: string | null;
}

export interface EventSourceLink {
  source: string;
  label: string;
  url: string;
}

export interface EventView {
  id: number;
  title: string;
  category: Category;
  venue: string | null;
  address: string | null;
  priceText: string | null;
  isFree: boolean | null;
  description: string | null;
  when: When;
  // Started before the requested range and still running in it.
  ongoing: boolean;
  moreDates: number;
  sources: EventSourceLink[];
}

export interface SourceStatus {
  id: string;
  label: string;
  lastOkAt: number | null;
  lastError: string | null;
  lastCount: number | null;
}

export interface Status {
  polling: boolean;
  place: { name: string; radiusKm: number };
  sources: SourceStatus[];
}
