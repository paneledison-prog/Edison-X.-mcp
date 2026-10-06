# Messaging app with conversation list and thread

_Original Edison X reference pattern. Owner-authored; contains no third-party content. License: owned._

- **Category:** messaging
- **Platform:** desktop
- **Tags:** chat-thread, split-screen, dark, sidebar-navigation
- **Palette:** #1a1d21, #222529, #4a9eff, #e8e8e8, #8b8f94

Three-pane layout: workspace rail, conversation list and the active thread with a composer.

## Structure

- **Layout:** Narrow icon rail, 300px conversation list, flexible thread pane with a pinned composer and a collapsible details panel.
- **Components:** workspace rail, conversation row, message bubble, composer, details panel
- **Typography:** 13px dense sans, 15px message text, monospace for code.
- **Color usage:** Charcoal layers with subtle elevation, blue for selection and links.
- **Density:** dense

## Build hints

- Group consecutive messages from the same sender
- Show unread counts as small badges
- Support keyboard navigation between conversations
