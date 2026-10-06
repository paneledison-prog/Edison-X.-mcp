# Sales CRM dashboard with pipeline board

_Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned._

- **Category:** dashboard
- **Platform:** web
- **Tags:** light, kanban-board, stat-cards, sidebar-navigation, data-dense
- **Palette:** #f8fafc, #ffffff, #0ea5e9, #6366f1, #0f172a

Sales overview with revenue stat cards on top and a kanban pipeline of deals below.

## Structure

- **Layout:** Fixed left sidebar; header with search and quick add; stat card row; horizontally scrolling kanban columns for deal stages.
- **Components:** sidebar navigation, stat card, kanban column, deal card, avatar stack, search bar
- **Typography:** 14px interface text, 24px tabular stat numbers, 12px column headers in small caps.
- **Color usage:** White cards on a pale slate page; sky blue for primary actions and indigo for the current stage.
- **Density:** dense

## Build hints

- Show the total value at the top of every kanban column
- Support drag between columns with a visible drop target
- Keep stat cards to four across on desktop
