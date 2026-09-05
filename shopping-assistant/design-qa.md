# Design QA

## Scope

- Screen: mobile shopping conversation, result summary, fixed composer
- Secondary surface: conversation management drawer
- Reference: `screenshots/chat-redesign-options/03-concierge-thread.png`
- Implementation: `screenshots/chat-concierge-current.png`
- Drawer capture: `screenshots/chat-concierge-drawer.png`
- Comparison: `screenshots/chat-concierge-comparison.png`
- Emulator: `Pixel_API_35` / `emulator-5554`

## Visual comparison

The reference and implementation were normalized to the same height and
combined into one comparison image before review.

### Typography

- SoleAI title weight and visual hierarchy match the reference.
- Assistant replies use unboxed body text with a fixed black `S` mark.
- User messages use compact right-aligned neutral bubbles.
- Header subtitle, status label, result metadata, and composer hint use the
  same restrained gray hierarchy as the reference.

### Spacing and layout

- Header, conversation thread, result summary, and fixed composer follow the
  same vertical structure as the reference.
- The result summary is a single horizontal row:
  thumbnails, remaining count, divider, candidate metadata, action.
- Bottom list padding prevents the result summary from being covered by the
  fixed composer.
- Drawer spacing is compact and uses the same black, white, and soft-gray
  language as the selected direction.

### Color and surfaces

- Background is warm off-white.
- Primary actions and assistant marks are near-black.
- Online state uses a small mint indicator.
- Shadows, borders, and radii are restrained; no gradients remain in the chat
  or drawer.

### Images and data

- Result thumbnails use live candidate image URLs.
- Candidate count and lowest price are calculated from the current product
  pool.
- Drawer title, candidate count, and relative time use persisted conversation
  data.

### Interactions

- Menu opens and closes the conversation drawer.
- New conversation and history selection retain existing callbacks.
- Camera, voice input, multiline text input, and send retain existing behavior.
- The conversation automatically scrolls to the latest user and assistant turn.
- A real backend turn returned a normal chat response while the header remained
  online.

## Findings

- P1 fixed: the first result summary was two rows and partly covered by the
  composer. It is now a single compact row with additional bottom safe space.
- P0 unresolved: none.
- P1 unresolved: none.
- P2 unresolved: none.

final result: passed
