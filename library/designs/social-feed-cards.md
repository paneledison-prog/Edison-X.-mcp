# Social feed with composer and reaction bar

_Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned._

- **Category:** feed
- **Platform:** ios
- **Tags:** mobile, feed, infinite-scroll, light, social
- **Palette:** #ffffff, #f2f2f7, #007aff, #1c1c1e, #8e8e93

Vertical feed of post cards with a composer on top and a compact reaction row under each post.

## Structure

- **Layout:** Single column; composer card; repeating post cards with header, media, text and action row; tab bar at the bottom.
- **Components:** composer, post card, reaction row, avatar, tab bar
- **Typography:** System sans, 15px body, 13px metadata.
- **Color usage:** White cards on a light grey base, blue for interactive icons.
- **Density:** balanced

## Build hints

- Load more posts before the user reaches the end
- Keep action icons at least 44px apart
- Show timestamps in relative form
