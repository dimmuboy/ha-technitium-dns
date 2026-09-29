# Technitium DNS Live

Home Assistant custom integration with a live Technitium DNS query panel.

## Features

- Polls Technitium query logs only while the panel is visible.
- Allow or block a domain directly from the live feed.
- Manual domain field for editing to a parent domain before applying a rule.
- Pause blocking for 5 or 15 minutes.
- Live-synced blocking switch that follows changes made in the Technitium admin console.
- Pause and resume live query refresh without stopping blocking-state synchronization.
- Statistics tab with query totals, blocked/cached rates, top domains, top blocked domains, top clients and a query chart.
- API token stays on the Home Assistant backend and is never exposed to the browser panel.
- Automatically detects an installed Technitium Query Logs app.

## Required Technitium permissions

Use a dedicated Technitium user/API token with:

- Logs: View
- Allowed: Modify + Delete
- Blocked: Modify + Delete
- Cache: Delete
- Settings: View + Modify
- Dashboard: View

`Settings: View + Modify` is used for the live blocking state, the persistent blocking switch and temporary pause buttons. `Dashboard: View` is required for the Statistics tab.

## Installation

Add this repository to HACS as a custom Integration repository, install it, then restart Home Assistant.

After restart:

`Settings -> Devices & services -> Add integration -> Technitium DNS Live`

Enter your Technitium base URL, for example:

`http://technitium.example:5380`

and a dedicated API token.

A `DNS Live` item will appear in the Home Assistant sidebar.

## Notes

The query feed is polling-based rather than a true stream. Polling starts only while the panel is visible and stops when the panel is left or the browser/app is backgrounded.
