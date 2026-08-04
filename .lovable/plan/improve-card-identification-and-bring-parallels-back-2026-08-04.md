# Improve card identification (and bring parallels back)

## What I found

Three concrete problems, confirmed in the code and your data:

1. **The photo sent to identification is shrunk before it is sent.** The crop dialog builds a high-resolution encode (1400x1960, quality 0.88) specifically so small print — card number, subset name, serial — stays legible. The scan handler then pushes that through the image compressor, which resizes anything above ~220KB down to 640x896. Identification is reading a heavily downscaled card.

2. **Half your cards have no catalog link, so the parallel picker is empty by design.** Of 88 cards, only 42 have a catalog id and just 1 has a parallel selected. The parallel picker only loads when a catalog id exists, and when a lookup fails the card is put on a 7-day cooldown before it will even retry. So for most cards there is nothing for the picker to show, and no way for you to fix it by hand.

3. **Only the front of the card is ever read.** Set, card number, serial, and "Rookie Card"/parallel wording are frequently printed on the back, which identification never sees.

## The plan

### 1. Stop degrading the identification image
Send the crop dialog's high-resolution encode to identification untouched. Keep the small, compressed encode for display/storage only. This is the single highest-impact change and costs nothing extra.

### 2. Add a manual "Find in catalog" picker
In Add/Edit card, a search field that queries the catalog with the details currently in the form and lists matching cards (year, set, card #, player) for you to pick. Choosing one sets the catalog id directly — which immediately makes the parallel/refractor picker work, and makes valuation use verified comps instead of falling back.

### 3. Make parallels reachable more often
- Retry the catalog lookup when you open Edit or the picker, instead of silently honoring the 7-day cooldown.
- When no catalog id exists, the picker says "Link this card to the catalog to choose a parallel" with a button to step 2, rather than showing an empty list.
- Keep the numbered/serial field feeding the picker so "/50"-style parallels rank first.

### 4. Optional second photo (back of card)
Allow a back-of-card photo during scan and feed both images to the vision read, so set name, card number, and serial printed on the back can be used. Fronts alone stay supported.

### 5. Confidence and disagreement handling
- Show which fields came from identification versus which are unverified, so a low-confidence scan visibly asks you to confirm year/set/card #.
- When the structured match and the vision read disagree, present both readings and let you choose, rather than silently picking one and marking it low confidence.

## Technical notes
- `src/lib/ai.functions.ts`: pass the identify-quality bytes straight to `identifyCardRest`; drop the `compressBytes` call on the identify path only.
- `src/components/CardCropDialog.tsx` / vault upload flow: keep both encodes; display path unchanged.
- `src/lib/cardsight.functions.ts`: add a `searchCardsightCards` server fn returning candidate cards for the manual picker; `listCardsightParallels` keeps requiring an explicit `card_id`.
- `src/lib/cards.functions.ts`: allow an explicit catalog-id set from the picker to clear `cardsight_lookup_failed_at` and re-run valuation; relax the cooldown for user-initiated actions only (never for background/bulk runs, so call volume stays low).
- `src/routes/_authenticated/vault.tsx`: catalog picker UI plus the parallel picker empty state.
- Item 4 adds one extra vision call per scan and only runs when a back photo is supplied.

## Suggested order
1 (image quality) and 2-3 (catalog link + parallels) first, since together they fix both complaints. 4 and 5 after, if the first pass isn't accurate enough.
