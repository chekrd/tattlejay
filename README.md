# Tattlejay

What's on in Brno, from every source in one list. A private, single-user app that runs on your Mac.

## Run it

```sh
pnpm install
pnpm start        # builds the page, then serves it on http://127.0.0.1:7440
```

On start it reads every source that has not been read in the last 20 hours, and looks again every half hour while it
runs. The Refresh button reads them all now.

The database lives in `~/Library/Application Support/tattlejay/tattlejay.db`. Set `TATTLEJAY_DATA_DIR` to keep it
elsewhere and `TATTLEJAY_PORT` to change the port.

## Work on it

```sh
pnpm serve        # the server alone, on :7440
pnpm dev          # the page with hot reload on :5174, talking to the server
pnpm check        # types, lint, tests
```

## How it fits together

- `server/sources/` holds one adapter per source. Each turns its feed into items: a title, a place, a category and the
  days (and times, when known) it happens.
- `server/ingest.ts` stores the items and decides which ones are the same event. It merges only when sure: same title
  at the same place, or two sources agreeing on a shared day. An unsure pair stays as two entries.
- `server/listing.ts` builds what the page shows: one entry per event with its next date in the chosen range, the most
  precise time any source gave, and a link to each source.
- `web/` is the page.

## Sources

| Source | What is kept |
| --- | --- |
| gotobrno.cz, through the city's open data (CC BY) | everything the feed gives; it has days but no start times |
| GoOut | facts only: title, time, venue, price and the link. Descriptions and images stay on GoOut |

The GoOut adapter reads the endpoint goout.net's own pages call, not a published API. Keep this app private.
