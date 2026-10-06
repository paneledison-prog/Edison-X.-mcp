# Mobile workout tracker with large set logger

_Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned._

- **Category:** health-fitness
- **Platform:** ios
- **Tags:** mobile, fitness, bottom-tab-bar, forms, dark
- **Palette:** #111827, #1f2937, #22c55e, #facc15, #f9fafb

Single-column workout logging with big tap targets, a rest timer pill and a bottom tab bar.

## Structure

- **Layout:** Single column; sticky top header with timer pill; scrolling list of exercise cards; fixed bottom tab bar with four tabs.
- **Components:** bottom tab bar, exercise card, set row stepper, timer pill, primary button
- **Typography:** Rounded sans, 17px body, 28px bold exercise titles, monospaced timer digits.
- **Color usage:** Dark grey base, green for completed sets, yellow only for the active rest timer.
- **Density:** balanced

## Build hints

- Make numeric steppers at least 44px tall
- Show the rest timer as a persistent pill above the tab bar
- Mark completed sets with color and a check, not color alone
