<p align="right"><strong>English</strong> / <a href="README_ja.md">日本語</a></p>

<h1 align="center">📅 GCal Utils</h1>

<p align="center">
  <strong>Tidy up Google Calendar when you view many calendars at once.</strong><br/>
  Merges duplicate events, hides events by regex, and shows a single calendar in one click.
</p>

> [!WARNING]
> Experimental. GCal Utils reads and rewrites Google Calendar's undocumented page structure, so a change on Google's side can break it without notice.

## Why GCal Utils?

- **Merge duplicate events**: a meeting shared by five people shows up once instead of as five narrow chips side by side, and each calendar's color stays visible as a stripe on its left edge
- **Hide events by regex**: events you never want to see are removed from the grid, and a `⊘N` badge on the date header tells you that something was hidden
- **Solo a calendar**: one click shows only that calendar, and a second click brings back exactly the calendars you had before

## 🚀 Quick Start

**Requirements:** Chrome, or another Chromium-based browser that supports Manifest V3.

1. Clone this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the repository directory

Open calendar.google.com in week view. Meetings that appear on several of the calendars you are viewing now show up as one chip. Tabs that were already open before installing need a reload, because Chrome injects the content script only into pages loaded after installation.

To turn GCal Utils off, switch the features off in the extension popup or remove the extension from `chrome://extensions/`.

## 📖 Usage

Merging and hiding apply to the time grid and the all-day row of the day, week, and custom-days views. The month, year, and schedule views are left unchanged.

### Merge duplicate events

Two events are treated as the same when they have the same Google event ID, or when they are on the same day (the same position in the all-day row) with the same title, start, and end. The event-ID match catches a single invitation shown on several calendars; the content match also catches copies that were created separately.

The merged event shows:

- A stripe on its left edge for each calendar, in that calendar's color
- A `×N` badge in front of the title with the number of calendars
- A list of the calendars when you hover over it

When some copies are accepted and others are not, the accepted copy is the one kept.

After merging, the remaining events in each day are laid out again so that none of them overlap, and they take over the width the removed copies used. In the all-day row, events move up into rows that became empty and the all-day area itself gets shorter.

### Hide events by regex

Enter one pattern per line in the extension popup. Each line is a JavaScript regular expression matched against the event title, ignoring case. Invalid patterns are reported under the text box as you type. For example:

```
^Lunch$
Focus time
```

Days with hidden events show a `⊘N` badge in the date header. Hovering over the badge lists the titles that were hidden. The space hidden events occupied is reclaimed in the same way as for merged events.

### Solo mode

Hover over a calendar in the left sidebar and an `S` button appears over the right end of the row, without changing the row's width. Clicking it shows only that calendar. Clicking the same button again restores the calendars that were visible before solo mode started; calendars that were hidden before stay hidden.

While in solo mode, clicking `S` on a different calendar switches to that calendar and keeps the original set to restore. GCal Utils switches calendars by clicking Google's own checkboxes, so the result is the same as toggling them by hand. The set to restore is saved in `chrome.storage.local` and survives a page reload.

## ⚙️ Configuration

All settings are in the extension popup and are saved in `chrome.storage.sync`.

| Setting | Default | Description |
|---|---|---|
| Merge duplicate events | On | Merge copies of the same event into one |
| Hide events by regex | On | Hide events whose title matches a hide pattern |
| Solo button on calendar list | On | Show the `S` button in the sidebar |
| Hide patterns | Empty | One regular expression per line, case-insensitive |

## 🔒 Permissions

- `storage`: save the settings and the calendars to restore after solo mode

## 🧪 Development

There is no build step and there are no dependencies.

| File | Role |
|---|---|
| `core.js` | Pure functions without DOM access: event ID decoding, duplicate grouping, layout. Covered by the tests |
| `content.js` | Merges, hides, and lays out events on the calendar grid |
| `solo.js` | Adds the solo button to the sidebar calendar list |
| `content.css` | Styles for the stripes, badges, hover list, and solo button |
| `popup.html`, `popup.js` | Settings popup |

Run the tests with Node.js's built-in test runner (checked with Node.js 26):

```sh
node --test
```

To try a change, click the reload button for GCal Utils in `chrome://extensions/`, then reload the Google Calendar tab.

## 🔧 Troubleshooting

### Nothing is merged

- Check that you are in the day, week, or custom-days view
- Check that "Merge duplicate events" is on in the popup
- Reload the Google Calendar tab if it was open before you installed or reloaded the extension
- Open both copies and compare them; copies with a different title, start, or end are not merged unless they share an event ID

### Events look out of place after dragging

Merged and re-laid-out events may not line up with Google's drag handling. Turn off the related feature in the popup before dragging, or reload the page after dragging.

### The solo button does not appear

- Check that "Solo button on calendar list" is on in the popup
- Open the left sidebar if it is collapsed
