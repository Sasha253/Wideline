A meter shows the model's confidence in a detected event, from 0 to 1.

- **Provide:** the score, and the auto-accept threshold for that event type (for example 0.75 for a shot).
- **States:** at or above the threshold, the meter uses `pitch`. Below it, add `wl-conf--low`, which switches to `warning`. Always show the number in the `data` style beside the bar. In detail views, add the words "below threshold" when it is low.
- **Use in:** review event rows, event detail panels and admin job views. Never show it on public profiles: published stats are verified, so confidence isn't relevant there.
