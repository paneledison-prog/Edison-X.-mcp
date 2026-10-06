# Passwordless mobile sign-in with code entry

_Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned._

- **Category:** sign-in
- **Platform:** ios
- **Tags:** mobile, minimal, forms, light
- **Palette:** #fafafa, #ffffff, #111111, #2563eb, #a1a1aa

Email entry followed by a six-box one-time code screen with auto-advance.

## Structure

- **Layout:** Single column; large title at top; one field; fixed primary button above the keyboard; code boxes in a centered row.
- **Components:** email field, six digit code boxes, resend link, primary button
- **Typography:** System sans, 34px title, 17px body.
- **Color usage:** Near-white background with black text and a blue accent for actions.
- **Density:** airy

## Build hints

- Auto-advance between code boxes and support paste
- Offer resend after a visible countdown
- Keep the button above the keyboard
