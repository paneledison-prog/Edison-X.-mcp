# Map discovery with synced result list

*Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned.*

- **Category:** maps
- **Platform:** web
- **Tags:** map-with-list, search, filter-bar, travel, light
- **Palette:** #ffffff, #e8f0fe, #ef4444, #0f172a, #64748b

A scrollable list on the left stays in sync with markers on a map, with filters along the top.

## Structure

- **Layout:** Filter row on top; left list of cards; right map filling the remaining space; hover link between cards and markers.
- **Components:** map, marker, result card, filter chip, price pin
- **Typography:** 14px card text, bold price pins.
- **Color usage:** Muted map tiles, red markers, white cards.
- **Density:** balanced

## Build hints

- Highlight the marker when a card is hovered
- Offer search this area on pan
- Collapse the list into a bottom sheet on mobile
