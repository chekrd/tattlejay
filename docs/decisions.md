# Decisions

Choices behind Tattlejay that the code does not explain, with the alternatives that were turned down. Deferred items
are not rejected: they can come back as proposals, not as defaults.

## Scope

- One user, no accounts. Sharing with friends may come later.
- No notifications. Newly announced events are not marked apart from older ones.
- Started by hand, not at login. On start it reads the sources and runs the day's model batch if it has not run yet.
- Used in a browser on the same machine. Phone and remote access are deferred; the layout stays usable at phone width.
- Interface in English, event text in its original language, no translation.
- Events with a place are in What's on. Online-only events are in their own Online tab, outside the place filter.
- Another city is for an occasional visit, not for switching home: it reads GoOut, and Kudy z nudy for the Czech
  regional capitals. Meetup and Luma are not read for other cities (no city search open to us, Luma is per community).

## Sources

- GoOut: store only the facts (title, time, venue, price, link) and link back to GoOut for detail.
- Facebook and Instagram: only by hand through Add one event (link, text or picture). No logged-in scraping.
- Luma: only the supported per-calendar ICS feeds, not the undocumented discovery endpoints.
- Meetup: the listed group pages and the online find pages. The Brno search page is not read; it was mostly online
  events.
- Reading a page is layered: a hand-written adapter for the big feeds, embedded schema.org events where a page has
  them, otherwise the model, and the model only when the page text changed.
- Národní divadlo, Filharmonie, JIC, MUNI, RHK Brno and Kudy z nudy have no structured data and are read by the model
  from one page each, not by hand-written adapters. They give that page's nearest events only.
- The count on the Sources page is what the last read gave, not how many events the app holds from that source.

## Model

- Calls go through the local Claude CLI on Sonnet, not an API key, with settings, tools and plugins turned off. Chosen
  knowingly: the CLI documentation does not address a personal script like this, and it shares usage limits with other
  Claude use.
- Scoring and the profile update run once a day, with no call ceiling. What the user starts by hand (adding a source,
  adding an event, Refresh my picks, visiting a city) calls the model at once.
- The taste profile is written by the model from ratings, and the user can read and edit it. Cold start: a few words
  of one's own plus rating starter events across categories.
- If the CLI fails, the listing keeps working and the error shows on the page.

## Listing and picks

- Picks are unrated, not hidden events scoring 60 or more, five per group: this week, this month, later.
- Duplicates merge only on a confident match; otherwise both are shown. A merged card lists every source.
- Dislike means "less like this" and hides the event; a filter shows hidden ones. Save counts as a like, adds the
  event to My plans and offers a calendar entry. Optional always/never rules apply to a venue or performer.
- Twelve fixed categories, assigned when an event is read. Filters are date, category and free only.
- Past 7 days is the seven days before today, not "since Monday", so the weekend is there on a Monday.

## Known gaps, not started

- Events only in the city feed have no start time; it could come from the gotobrno detail page.
- Events left in Other could be categorised by the model.
- Page sources read one page only.
- Daily reading depends on starting the app; a login item would remove that.
