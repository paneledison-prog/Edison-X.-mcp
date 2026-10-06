# Dark fitness dashboard with ring progress

*Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned.*

- **Category:** dashboard
- **Platform:** web
- **Tags:** dark, fitness, stat-cards, progress-tracker, charts
- **Palette:** #0b0f19, #151b2b, #2dd4bf, #f97316, #e2e8f0

Dark workout dashboard: activity rings on top, weekly volume chart below, upcoming sessions in a side column.

## Structure

- **Layout:** Two-column: wide main area with ring summary row and chart, narrow right rail with schedule list; sticky left icon nav.
- **Components:** icon sidebar, activity ring, stat card, bar chart, schedule list
- **Typography:** Geometric sans for numbers, 12px uppercase labels, 32px tabular figures for key stats.
- **Color usage:** Near-black surfaces with one teal accent for progress and one orange accent for warnings; text in cool light grey.
- **Density:** balanced

## Build hints

- Give each ring its own accent and a numeric center label
- Use tabular numerals so stats do not jitter
- Keep the right rail at about 320px and collapse it below 1100px
