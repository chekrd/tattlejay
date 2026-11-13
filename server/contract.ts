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

// Saving is liking plus "I plan to go".
export const RATING_VALUES = ['like', 'dislike', 'save'] as const;
export type RatingValue = (typeof RATING_VALUES)[number];

// The text is matched against an event's title and venue.
export interface Rule {
  id: number;
  text: string;
  verdict: 'always' | 'never';
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
  rating: RatingValue | null;
  // Disliked, or matched by a "never" rule.
  hidden: boolean;
  // Null until the taste model has scored the event against the current profile.
  score: number | null;
  reason: string | null;
}

export interface Picks {
  week: EventView[];
  month: EventView[];
  later: EventView[];
}

export interface SourceStatus {
  id: string;
  label: string;
  home: string;
  // Set for a page the person added (or one of the pages added for them), which can be removed.
  pageId: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  lastCount: number | null;
}

export interface TasteStatus {
  // A profile exists, so events can be scored.
  ready: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  // Ratings or your own words changed since the profile was built, or events wait to be scored.
  stale: boolean;
  lastRunAt: number | null;
  error: string | null;
}

// Home is place 0; the others are cities looked at since.
export interface PlaceView {
  id: number;
  name: string;
  radiusKm: number;
}

// What looking at another city found, source by source.
export interface Visit {
  place: PlaceView;
  found: { label: string; count: number; note: string | null }[];
}

export interface Status {
  polling: boolean;
  places: PlaceView[];
  sources: SourceStatus[];
  taste: TasteStatus;
}

export interface Taste {
  seed: string;
  profile: string;
  rules: Rule[];
  rated: number;
}

// An event as read off a page or a capture, before it is accepted.
export interface FoundEvent {
  title: string;
  when: When;
  moreDates: number;
  venue: string | null;
  address: string | null;
  category: Category;
  priceText: string | null;
  url: string;
}

export interface PagePreview {
  url: string;
  label: string;
  method: 'embedded' | 'model';
  events: FoundEvent[];
}

export interface Capture {
  // Hand this back to add the event.
  token: string;
  event: FoundEvent;
}
