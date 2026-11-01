A row is one event in the review workspace's event list. A scout works through the list from the keyboard while the clip plays beside it.

- **Provide:** the match time (`data` style), event type, team side, the linked player or "Unlinked track N", confidence, and state.
- **Current row:** the selected event uses `aria-current="true"`, which gives it a `pitch-soft` fill and a 3px pitch bar on its left edge. Only the current row has this bar; it is a selection marker, not decoration.
- **Actions:** confirm (Y), edit (E) and reject (N), each a 36px icon button with an `aria-label` that names its shortcut. J and K move between rows. Once handled, a row collapses its actions into a status chip.
- **Phone:** the row stacks, with the time and type on the first line, and the actions as full-width 48px buttons under the video.
- **Who-labels (C11, Q-021):** `who` may be a label built on the server: "#7 Thabo Nkosi" for a scout-visible player, "Home #7" for any other lineup player, "Home team" or "Away team" for an event with no player. The client never gets a name it may not show.
- **Side not set (C11):** `side={null}` shows no marker; screen readers hear "Side not set". Add "· side not set" to the who-label so the state is visible too.
- **Manual events (C11):** an event a scout added has no confidence (`source="scout"`), so no meter shows.
- **Status disc (C11):** dashed "Pending", solid "Confirmed" (a person checked it), struck "Rejected", outline "Auto-accepted" (`auto_accepted`, the model above its threshold) and outline "Added by a scout" (`manual`). An auto-accepted event never shows the Confirmed disc. Each disc has its word as a tooltip and as sr-only text.
