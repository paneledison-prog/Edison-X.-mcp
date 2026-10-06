# End-to-end transcripts

Generated 2026-10-06T01:26:19.743Z by `pnpm e2e:transcripts`. The "agent" is a scripted MCP client, not a language model: it proves the real transports, auth and tools work together for three build goals. Running a real model against the server (Claude as a custom connector) is a manual step described in docs/CONNECTING.md.

## Agent A over Streamable HTTP (own key, search-only scopes)

Connected. Tools: search_inspiration, get_design, find_similar_designs, get_inspiration_brief, list_taxonomy, list_sources, create_collection, add_to_collection, list_collections, get_collection, submit_design, get_connection_status

### Goal: dark fitness dashboard, mobile

`search_inspiration({"query":"dark fitness dashboard","platform":"ios","limit":5})` -> 5 results; sources_queried=["library"]
- library:fitness-dashboard-dark - Dark fitness dashboard with ring progress - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-dashboard-dark.md
- library:smart-home-dashboard-mobile - Smart home control dashboard - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/smart-home-dashboard-mobile.md
- library:crm-sales-dashboard - Sales CRM dashboard with pipeline board - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/crm-sales-dashboard.md
- library:fitness-tracker-mobile - Mobile workout tracker with large set logger - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-tracker-mobile.md
- library:health-habit-tracker - Habit tracker with streak calendar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/health-habit-tracker.md

`get_design({"id":"library:fitness-dashboard-dark"})` -> license=owned, palette=["#0b0f19","#151b2b","#2dd4bf","#f97316","#e2e8f0"]
  - layout: Two-column: wide main area with ring summary row and chart, narrow right rail with schedule list; sticky left icon nav.
  - components: icon sidebar, activity ring, stat card, bar chart, schedule list
  - build hints: Give each ring its own accent and a numeric center label; Use tabular numerals so stats do not jitter; Keep the right rail at about 320px and collapse it below 1100px

`get_inspiration_brief({"goal":"dark fitness dashboard, mobile"})` -> confidence=high, based_on 6 designs
  - ui-pattern: stat-cards  (evidence: library:crm-sales-dashboard, library:fitness-dashboard-dark, library:smart-home-dashboard-mobile)
  - ui-pattern: card-grid  (evidence: library:meal-planner-week, library:smart-home-dashboard-mobile)
  - ui-pattern: progress-tracker  (evidence: library:fitness-dashboard-dark, library:health-habit-tracker)
  - component: stat card  (evidence: library:crm-sales-dashboard, library:fitness-dashboard-dark, library:smart-home-dashboard-mobile)
  - density: balanced (4 of 6 analysed references)  (evidence: library:fitness-dashboard-dark, library:fitness-tracker-mobile, library:health-habit-tracker, library:smart-home-dashboard-mobile)
  - density: dense (2 of 6 analysed references)  (evidence: library:crm-sales-dashboard, library:meal-planner-week)
  - suggested components: stat card, activity ring, avatar stack, bar chart, bottom navigation, bottom tab bar, date strip, deal card, device tile, drag handle, energy chart, exercise card
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel. | Check text contrast on dark surfaces and aim for 4.5:1 or better.

### Goal: SaaS landing page with pricing

`search_inspiration({"query":"saas landing page with pricing table","platform":"web","limit":5})` -> 5 results; sources_queried=["library"]
- library:pricing-three-tier - Three-tier pricing table with toggle - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/pricing-three-tier.md
- library:saas-landing-hero - SaaS landing page with product screenshot hero - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/saas-landing-hero.md
- library:editorial-landing-bold - Editorial landing page with oversized type - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/editorial-landing-bold.md
- library:product-launch-gradient - Product launch page with animated gradient - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/product-launch-gradient.md
- library:admin-data-table - Admin console with filterable data table - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/admin-data-table.md

`get_design({"id":"library:pricing-three-tier"})` -> license=owned, palette=["#ffffff","#f8fafc","#7c3aed","#0f172a","#94a3b8"]
  - layout: Centered header with toggle; three equal cards; middle card raised with an accent border; comparison table below.
  - components: billing toggle, plan card, feature checklist, popular badge, comparison table
  - build hints: Show the yearly saving as a percentage; Keep feature lists parallel in wording; Repeat the primary button label

`get_inspiration_brief({"goal":"SaaS landing page with pricing"})` -> confidence=high, based_on 6 designs
  - ui-pattern: hero-section  (evidence: library:editorial-landing-bold, library:product-launch-gradient, library:saas-landing-hero)
  - ui-pattern: filter-bar  (evidence: library:ecommerce-grid-filters, library:map-with-list)
  - density: balanced (4 of 6 analysed references)  (evidence: library:ecommerce-grid-filters, library:map-with-list, library:pricing-three-tier, library:product-launch-gradient)
  - density: airy (2 of 6 analysed references)  (evidence: library:editorial-landing-bold, library:saas-landing-hero)
  - suggested components: badge, billing toggle, comparison table, countdown, email capture form, feature card, feature checklist, filter chip, filter group, footer index, glass card, gradient background
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel.

### Goal: habit tracker with streaks

`search_inspiration({"query":"habit tracker streak calendar","platform":"android","limit":5})` -> 5 results; sources_queried=["library"]
- library:health-habit-tracker - Habit tracker with streak calendar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/health-habit-tracker.md
- library:calendar-week-view - Calendar week view with event drawer - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/calendar-week-view.md
- library:fitness-tracker-mobile - Mobile workout tracker with large set logger - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-tracker-mobile.md
- library:course-lesson-view - Online course lesson with outline sidebar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/course-lesson-view.md
- library:travel-itinerary-planner - Trip itinerary planner with day timeline - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/travel-itinerary-planner.md

`get_design({"id":"library:health-habit-tracker"})` -> license=owned, palette=["#fef3c7","#ffffff","#f59e0b","#7c3aed","#1f2937"]
  - layout: Header with date strip; list of habit cards with check controls; monthly heatmap section; floating add button.
  - components: date strip, habit card, streak badge, heatmap calendar, floating action button
  - build hints: Celebrate streaks with subtle motion; Let users skip a day without breaking a streak; Keep the add button reachable with one thumb

`get_inspiration_brief({"goal":"habit tracker with streaks"})` -> confidence=high, based_on 5 designs
  - ui-pattern: progress-tracker  (evidence: library:course-lesson-view, library:fitness-dashboard-dark, library:health-habit-tracker, library:onboarding-stepper-web)
  - density: balanced (4 of 5 analysed references)  (evidence: library:course-lesson-view, library:fitness-dashboard-dark, library:fitness-tracker-mobile, library:health-habit-tracker)
  - suggested components: activity ring, back and next buttons, bar chart, bottom tab bar, choice chips, course outline, date strip, exercise card, floating action button, form card, habit card, heatmap calendar
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel.

Agent A tries `create_collection` -> isError=true: This key lacks the required scope 'write:collections'. Ask the owner for a key that includes it.

## Agent B over Streamable HTTP (a second agent, its own key, no code changes)

Connected. Tools: search_inspiration, get_design, find_similar_designs, get_inspiration_brief, list_taxonomy, list_sources, create_collection, add_to_collection, list_collections, get_collection, submit_design, get_connection_status

### Goal: dark fitness dashboard, mobile

`search_inspiration({"query":"dark fitness dashboard","platform":"ios","limit":5})` -> 5 results; sources_queried=["library"]
- library:fitness-dashboard-dark - Dark fitness dashboard with ring progress - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-dashboard-dark.md
- library:smart-home-dashboard-mobile - Smart home control dashboard - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/smart-home-dashboard-mobile.md
- library:crm-sales-dashboard - Sales CRM dashboard with pipeline board - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/crm-sales-dashboard.md
- library:fitness-tracker-mobile - Mobile workout tracker with large set logger - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-tracker-mobile.md
- library:health-habit-tracker - Habit tracker with streak calendar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/health-habit-tracker.md

`get_design({"id":"library:fitness-dashboard-dark"})` -> license=owned, palette=["#0b0f19","#151b2b","#2dd4bf","#f97316","#e2e8f0"]
  - layout: Two-column: wide main area with ring summary row and chart, narrow right rail with schedule list; sticky left icon nav.
  - components: icon sidebar, activity ring, stat card, bar chart, schedule list
  - build hints: Give each ring its own accent and a numeric center label; Use tabular numerals so stats do not jitter; Keep the right rail at about 320px and collapse it below 1100px

`get_inspiration_brief({"goal":"dark fitness dashboard, mobile"})` -> confidence=high, based_on 6 designs
  - ui-pattern: stat-cards  (evidence: library:crm-sales-dashboard, library:fitness-dashboard-dark, library:smart-home-dashboard-mobile)
  - ui-pattern: card-grid  (evidence: library:meal-planner-week, library:smart-home-dashboard-mobile)
  - ui-pattern: progress-tracker  (evidence: library:fitness-dashboard-dark, library:health-habit-tracker)
  - component: stat card  (evidence: library:crm-sales-dashboard, library:fitness-dashboard-dark, library:smart-home-dashboard-mobile)
  - density: balanced (4 of 6 analysed references)  (evidence: library:fitness-dashboard-dark, library:fitness-tracker-mobile, library:health-habit-tracker, library:smart-home-dashboard-mobile)
  - density: dense (2 of 6 analysed references)  (evidence: library:crm-sales-dashboard, library:meal-planner-week)
  - suggested components: stat card, activity ring, avatar stack, bar chart, bottom navigation, bottom tab bar, date strip, deal card, device tile, drag handle, energy chart, exercise card
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel. | Check text contrast on dark surfaces and aim for 4.5:1 or better.

### Goal: SaaS landing page with pricing

`search_inspiration({"query":"saas landing page with pricing table","platform":"web","limit":5})` -> 5 results; sources_queried=["library"]
- library:pricing-three-tier - Three-tier pricing table with toggle - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/pricing-three-tier.md
- library:saas-landing-hero - SaaS landing page with product screenshot hero - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/saas-landing-hero.md
- library:editorial-landing-bold - Editorial landing page with oversized type - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/editorial-landing-bold.md
- library:product-launch-gradient - Product launch page with animated gradient - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/product-launch-gradient.md
- library:admin-data-table - Admin console with filterable data table - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/admin-data-table.md

`get_design({"id":"library:pricing-three-tier"})` -> license=owned, palette=["#ffffff","#f8fafc","#7c3aed","#0f172a","#94a3b8"]
  - layout: Centered header with toggle; three equal cards; middle card raised with an accent border; comparison table below.
  - components: billing toggle, plan card, feature checklist, popular badge, comparison table
  - build hints: Show the yearly saving as a percentage; Keep feature lists parallel in wording; Repeat the primary button label

`get_inspiration_brief({"goal":"SaaS landing page with pricing"})` -> confidence=high, based_on 6 designs
  - ui-pattern: hero-section  (evidence: library:editorial-landing-bold, library:product-launch-gradient, library:saas-landing-hero)
  - ui-pattern: filter-bar  (evidence: library:ecommerce-grid-filters, library:map-with-list)
  - density: balanced (4 of 6 analysed references)  (evidence: library:ecommerce-grid-filters, library:map-with-list, library:pricing-three-tier, library:product-launch-gradient)
  - density: airy (2 of 6 analysed references)  (evidence: library:editorial-landing-bold, library:saas-landing-hero)
  - suggested components: badge, billing toggle, comparison table, countdown, email capture form, feature card, feature checklist, filter chip, filter group, footer index, glass card, gradient background
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel.

### Goal: habit tracker with streaks

`search_inspiration({"query":"habit tracker streak calendar","platform":"android","limit":5})` -> 5 results; sources_queried=["library"]
- library:health-habit-tracker - Habit tracker with streak calendar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/health-habit-tracker.md
- library:calendar-week-view - Calendar week view with event drawer - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/calendar-week-view.md
- library:fitness-tracker-mobile - Mobile workout tracker with large set logger - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-tracker-mobile.md
- library:course-lesson-view - Online course lesson with outline sidebar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/course-lesson-view.md
- library:travel-itinerary-planner - Trip itinerary planner with day timeline - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/travel-itinerary-planner.md

`get_design({"id":"library:health-habit-tracker"})` -> license=owned, palette=["#fef3c7","#ffffff","#f59e0b","#7c3aed","#1f2937"]
  - layout: Header with date strip; list of habit cards with check controls; monthly heatmap section; floating add button.
  - components: date strip, habit card, streak badge, heatmap calendar, floating action button
  - build hints: Celebrate streaks with subtle motion; Let users skip a day without breaking a streak; Keep the add button reachable with one thumb

`get_inspiration_brief({"goal":"habit tracker with streaks"})` -> confidence=high, based_on 5 designs
  - ui-pattern: progress-tracker  (evidence: library:course-lesson-view, library:fitness-dashboard-dark, library:health-habit-tracker, library:onboarding-stepper-web)
  - density: balanced (4 of 5 analysed references)  (evidence: library:course-lesson-view, library:fitness-dashboard-dark, library:fitness-tracker-mobile, library:health-habit-tracker)
  - suggested components: activity ring, back and next buttons, bar chart, bottom tab bar, choice chips, course outline, date strip, exercise card, floating action button, form card, habit card, heatmap calendar
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel.

Agent B creates a collection, adds a design, reads it back -> library:fitness-tracker-mobile

## A local agent over stdio

Connected. Tools: search_inspiration, get_design, find_similar_designs, get_inspiration_brief, list_taxonomy, list_sources, create_collection, add_to_collection, list_collections, get_collection, submit_design, get_connection_status

### Goal: dark fitness dashboard, mobile

`search_inspiration({"query":"dark fitness dashboard","platform":"ios","limit":5})` -> 5 results; sources_queried=["library"]
- library:fitness-dashboard-dark - Dark fitness dashboard with ring progress - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-dashboard-dark.md
- library:smart-home-dashboard-mobile - Smart home control dashboard - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/smart-home-dashboard-mobile.md
- library:crm-sales-dashboard - Sales CRM dashboard with pipeline board - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/crm-sales-dashboard.md
- library:fitness-tracker-mobile - Mobile workout tracker with large set logger - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-tracker-mobile.md
- library:health-habit-tracker - Habit tracker with streak calendar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/health-habit-tracker.md

`get_design({"id":"library:fitness-dashboard-dark"})` -> license=owned, palette=["#0b0f19","#151b2b","#2dd4bf","#f97316","#e2e8f0"]
  - layout: Two-column: wide main area with ring summary row and chart, narrow right rail with schedule list; sticky left icon nav.
  - components: icon sidebar, activity ring, stat card, bar chart, schedule list
  - build hints: Give each ring its own accent and a numeric center label; Use tabular numerals so stats do not jitter; Keep the right rail at about 320px and collapse it below 1100px

`get_inspiration_brief({"goal":"dark fitness dashboard, mobile"})` -> confidence=high, based_on 6 designs
  - ui-pattern: stat-cards  (evidence: library:crm-sales-dashboard, library:fitness-dashboard-dark, library:smart-home-dashboard-mobile)
  - ui-pattern: card-grid  (evidence: library:meal-planner-week, library:smart-home-dashboard-mobile)
  - ui-pattern: progress-tracker  (evidence: library:fitness-dashboard-dark, library:health-habit-tracker)
  - component: stat card  (evidence: library:crm-sales-dashboard, library:fitness-dashboard-dark, library:smart-home-dashboard-mobile)
  - density: balanced (4 of 6 analysed references)  (evidence: library:fitness-dashboard-dark, library:fitness-tracker-mobile, library:health-habit-tracker, library:smart-home-dashboard-mobile)
  - density: dense (2 of 6 analysed references)  (evidence: library:crm-sales-dashboard, library:meal-planner-week)
  - suggested components: stat card, activity ring, avatar stack, bar chart, bottom navigation, bottom tab bar, date strip, deal card, device tile, drag handle, energy chart, exercise card
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel. | Check text contrast on dark surfaces and aim for 4.5:1 or better.

### Goal: SaaS landing page with pricing

`search_inspiration({"query":"saas landing page with pricing table","platform":"web","limit":5})` -> 5 results; sources_queried=["library"]
- library:pricing-three-tier - Three-tier pricing table with toggle - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/pricing-three-tier.md
- library:saas-landing-hero - SaaS landing page with product screenshot hero - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/saas-landing-hero.md
- library:editorial-landing-bold - Editorial landing page with oversized type - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/editorial-landing-bold.md
- library:product-launch-gradient - Product launch page with animated gradient - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/product-launch-gradient.md
- library:admin-data-table - Admin console with filterable data table - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/admin-data-table.md

`get_design({"id":"library:pricing-three-tier"})` -> license=owned, palette=["#ffffff","#f8fafc","#7c3aed","#0f172a","#94a3b8"]
  - layout: Centered header with toggle; three equal cards; middle card raised with an accent border; comparison table below.
  - components: billing toggle, plan card, feature checklist, popular badge, comparison table
  - build hints: Show the yearly saving as a percentage; Keep feature lists parallel in wording; Repeat the primary button label

`get_inspiration_brief({"goal":"SaaS landing page with pricing"})` -> confidence=high, based_on 6 designs
  - ui-pattern: hero-section  (evidence: library:editorial-landing-bold, library:product-launch-gradient, library:saas-landing-hero)
  - ui-pattern: filter-bar  (evidence: library:ecommerce-grid-filters, library:map-with-list)
  - density: balanced (4 of 6 analysed references)  (evidence: library:ecommerce-grid-filters, library:map-with-list, library:pricing-three-tier, library:product-launch-gradient)
  - density: airy (2 of 6 analysed references)  (evidence: library:editorial-landing-bold, library:saas-landing-hero)
  - suggested components: badge, billing toggle, comparison table, countdown, email capture form, feature card, feature checklist, filter chip, filter group, footer index, glass card, gradient background
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel.

### Goal: habit tracker with streaks

`search_inspiration({"query":"habit tracker streak calendar","platform":"android","limit":5})` -> 5 results; sources_queried=["library"]
- library:health-habit-tracker - Habit tracker with streak calendar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/health-habit-tracker.md
- library:calendar-week-view - Calendar week view with event drawer - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/calendar-week-view.md
- library:fitness-tracker-mobile - Mobile workout tracker with large set logger - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/fitness-tracker-mobile.md
- library:course-lesson-view - Online course lesson with outline sidebar - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/course-lesson-view.md
- library:travel-itinerary-planner - Trip itinerary planner with day timeline - Original Edison X reference pattern - owner-authored, no third-party content - https://github.com/paneledison-prog/Edison-X.-mcp/blob/main/library/designs/travel-itinerary-planner.md

`get_design({"id":"library:health-habit-tracker"})` -> license=owned, palette=["#fef3c7","#ffffff","#f59e0b","#7c3aed","#1f2937"]
  - layout: Header with date strip; list of habit cards with check controls; monthly heatmap section; floating add button.
  - components: date strip, habit card, streak badge, heatmap calendar, floating action button
  - build hints: Celebrate streaks with subtle motion; Let users skip a day without breaking a streak; Keep the add button reachable with one thumb

`get_inspiration_brief({"goal":"habit tracker with streaks"})` -> confidence=high, based_on 5 designs
  - ui-pattern: progress-tracker  (evidence: library:course-lesson-view, library:fitness-dashboard-dark, library:health-habit-tracker, library:onboarding-stepper-web)
  - density: balanced (4 of 5 analysed references)  (evidence: library:course-lesson-view, library:fitness-dashboard-dark, library:fitness-tracker-mobile, library:health-habit-tracker)
  - suggested components: activity ring, back and next buttons, bar chart, bottom tab bar, choice chips, course outline, date strip, exercise card, floating action button, form card, habit card, heatmap calendar
  - pitfalls: Use these references for structure and patterns; do not copy any design pixel for pixel.

