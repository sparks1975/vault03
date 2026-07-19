Add a visible progress bar to the dashboard when the user taps **Re-value** so they can see completion status while all cards are revalued.

### Plan

1. **Progress UI state**
   - In `src/routes/_authenticated/dashboard.tsx`, add local state to track whether a bulk revaluation is running, the current card index, total count, and the name of the card currently being processed.

2. **Client-driven revaluation loop**
   - Replace the single `revalueAllCards` mutation with an async loop that revalues each card one by one using the existing `estimateCardValue` and `replaceValuation` server functions.
   - After each card finishes, update the progress state so the UI reflects real progress.
   - Continue on per-card failures and count failures, matching the current behavior of the server-side bulk function.

3. **Progress overlay**
   - Show a modal/overlay while the bulk revaluation is active using the existing `Progress` component from `src/components/ui/progress.tsx`.
   - Display processed count / total, percentage, and the current card name.
   - Disable the **Re-value** button and prevent duplicate runs while one is in progress.

4. **Completion and cleanup**
   - On completion, invalidate the `cards` query so the updated values appear.
   - Show a summary toast with how many cards were re-valued and how many failed.
   - Reset progress state and close the overlay.

5. **Keep server-side helper**
   - Leave `revalueAllCards` in `src/lib/cards.functions.ts` intact so it can still be used by other flows or re-enabled later without re-implementation.

### Files to modify
- `src/routes/_authenticated/dashboard.tsx`