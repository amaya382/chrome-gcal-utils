<p align="right"><strong>English</strong> / <a href="README_ja.md">日本語</a></p>

<h1 align="center">📅 GCal Utils Chrome Extension</h1>

<p align="center"><strong>Keep Google Calendar readable, however many calendars you overlay.</strong></p>

> [!WARNING]
> Experimental. GCal Utils reads and rewrites Google Calendar's undocumented page structure, so a change on Google's side can break it without notice.

## ✨ Features

- **Merge duplicate events** — a meeting that appears on several of the calendars you are viewing shows up as one chip instead of several narrow ones side by side. A colored stripe for each calendar and a hover list with each calendar's response keep track of whose event it is
- **Hide events by regex** — events whose titles match your patterns disappear from the grid, and a `⊘N` badge on the date header shows that something was hidden
- **Reclaim the freed space** — the remaining events are laid out again so they take over the width and all-day rows that merged and hidden events used
- **Solo a calendar** — one click on the `S` button in the sidebar shows only that calendar, and a second click brings back exactly the calendars you had before
- **Fold early morning and late night** — the hours you rarely use shrink to a thin band with a count of the events inside, so more of the day fits on screen

## 🚀 Quick Start

**Requirements:** Chrome, or another Chromium-based browser that supports Manifest V3.

1. Clone this repository
2. Open `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the repository directory

Open calendar.google.com in week view. Meetings that appear on several of the calendars you are viewing now show up as one chip. Tabs that were already open before installing need a reload, because Chrome injects the content script only into pages loaded after installation.

To turn GCal Utils off, switch the features off in the extension popup or remove the extension from `chrome://extensions/`.

## ⚙️ Configuration

All settings are in the extension popup and are saved in `chrome.storage.sync`.

| Setting | Default | Description |
|---|---|---|
| Merge duplicate events | On | Merge copies of the same event into one |
| Hide events by regex | On | Hide events whose title matches a hide pattern |
| Solo button on calendar list | On | Show the `S` button in the sidebar |
| Hide patterns | Empty | One regular expression per line, case-insensitive |
| Fold early morning and late night | On | Fold the early-morning and late-night ranges of the time grid |
| Early morning | 8 | Early morning is 00:00 up to this hour; 0 turns it off |
| Late night | 20 | Late night is this hour up to 24:00; 24 turns it off |

## 🔒 Permissions

- `storage`: save the settings, the calendars to restore after solo mode, and which folded ranges are expanded

## 🧪 Development

There is no build step and there are no dependencies.

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
