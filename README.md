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

## Picks

Like, dislike or save events, and say what you like in your own words under **My taste**. From those the app keeps a
short written taste profile, which you can read and edit, and scores every upcoming event against it. The strongest
unrated matches show as **Picked for you**, each with its reason.

The writing and scoring are done by the Claude CLI (`claude -p`) under your own login, on Sonnet, as a plain
completion: no tools, no settings, no plugins, run from an empty folder of the app's own. It runs once a day after the
sources are read, and when you press **Refresh my picks**. A full scoring pass sends about one call per 50 events.
If the CLI fails, the listing keeps working and the page says what went wrong.

`TATTLEJAY_CLAUDE` names the CLI to run (default `claude`) and `TATTLEJAY_MODEL` the model (default `sonnet`).

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
  precise time any source gave, and a link to each source. It also lays your ratings, rules and scores over the events
  and chooses the picks.
- `server/taste.ts` keeps the taste profile and the scores; `server/model.ts` is the only place that calls the CLI.
- `web/` is the page.

## Sources

| Source | How it is read | Notes |
| --- | --- | --- |
| gotobrno.cz | the city's open data feed (CC BY) | days but no start times |
| GoOut | the endpoint its own pages call | facts only: title, time, venue, price, link |
| Městské divadlo Brno | its programme API | one entry per production |
| Kino Scala | events embedded in its front page | one entry per film |
| Kino Art | its programme page | one entry per film |
| Impact Hub Brno | its calendar API | |
| Meetup | each listed group's events page | groups are listed in `server/sources/meetup.ts` |
| Luma | calendar subscriptions | communities are listed in `server/sources/calendars.ts` |
| Brno.AI | events embedded in its listing | only in-person events in or by Brno |
| Pyvo, WUG Brno, Base48 | their calendar feeds | Base48's own meetings are left out |
| Brno Expat Centre | its events feed | |

The **Sources** view shows when each was last read and how many events it gave. A source that fails keeps the events
it gave last time and says what went wrong.

The GoOut and Meetup adapters read data those sites embed for their own pages, not a published API. Keep this app
private.
