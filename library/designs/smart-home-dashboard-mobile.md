# Smart home control dashboard

*Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned.*

- **Category:** dashboard
- **Platform:** android
- **Tags:** dark, mobile, stat-cards, card-grid, playful
- **Palette:** #0f172a, #1e293b, #38bdf8, #fbbf24, #f1f5f9

Room tabs above a two-column grid of device tiles with toggles and a live energy chart.

## Structure

- **Layout:** Top app bar with room chips; two-column tile grid; energy summary card pinned above the grid; bottom navigation.
- **Components:** room chip, device tile, toggle switch, energy chart, bottom navigation, stat card
- **Typography:** Rounded sans, 16px tile titles, 12px status text, 28px energy figure.
- **Color usage:** Dark navy surfaces; sky blue marks active devices and amber marks warnings.
- **Density:** balanced

## Build hints

- Make the whole tile tappable, not only the toggle
- Show state with color plus a text label
- Keep the energy card collapsible
