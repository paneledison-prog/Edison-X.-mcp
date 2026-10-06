# One-page checkout with order summary

*Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned.*

- **Category:** checkout
- **Platform:** web
- **Tags:** light, forms, multi-step-form, retail
- **Palette:** #ffffff, #f9fafb, #2563eb, #111827, #d1d5db

Contact, shipping and payment sections stacked on the left with a persistent order summary on the right.

## Structure

- **Layout:** Two columns at 60/40; accordion-style sections with completed states; summary card with line items and totals.
- **Components:** accordion section, address form, payment fields, order summary, place order button
- **Typography:** 15px labels, 20px section titles, bold totals.
- **Color usage:** White cards on a light grey page, blue for the primary action, subtle borders.
- **Density:** balanced

## Build hints

- Show a progress hint for each section
- Collapse the summary on mobile
- Place the primary button at the end of the form and repeat the total next to it
