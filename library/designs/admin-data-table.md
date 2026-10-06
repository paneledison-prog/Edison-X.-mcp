# Admin console with filterable data table

_Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned._

- **Category:** admin
- **Platform:** web
- **Tags:** admin, data-table, sidebar-navigation, light, data-dense
- **Palette:** #ffffff, #f3f4f6, #4f46e5, #111827, #6b7280

Left navigation, a toolbar with filters and bulk actions, and a dense table with row menus.

## Structure

- **Layout:** Fixed left sidebar; top bar with breadcrumbs; toolbar above a full-width table; pagination footer.
- **Components:** sidebar, data table, bulk action bar, status badge, row menu
- **Typography:** 13px table text, 12px headers in small caps, 20px page title.
- **Color usage:** White table on a light grey page, indigo for selection, colored badges for status.
- **Density:** dense

## Build hints

- Make table headers sticky
- Show bulk actions only when rows are selected
- Provide column visibility controls
