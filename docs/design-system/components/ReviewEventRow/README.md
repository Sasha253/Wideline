A row is one event in the review workspace's event list. A scout works through the list from the keyboard while the clip plays beside it.

- **Provide:** the match time (`data` style), event type, team side, the linked player or "Unlinked track N", confidence, and state.
- **Current row:** the selected event uses `aria-current="true"`, which gives it a `pitch-soft` fill and a 3px pitch bar on its left edge. Only the current row has this bar; it is a selection marker, not decoration.
- **Actions:** confirm (Y), edit (E) and reject (N), each a 36px icon button with an `aria-label` that names its shortcut. J and K move between rows. Once handled, a row collapses its actions into a status chip.
- **Phone:** the row stacks, with the time and type on the first line, and the actions as full-width 48px buttons under the video.
