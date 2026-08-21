# Simplify valuation comp matching

## Changes
- Build sold-listing searches from only the card year, parent brand, exact card number, and player name.
- Normalize detailed products such as Bowman Sterling or Topps Chrome to their parent brands for valuation searches.
- Verify comp identity using year, parent brand, exact card number, and player name instead of requiring the detailed catalog set name.
- Keep the existing safeguards that reject boxes/lots, active listings, wrong parallels, serial mismatches, and autograph mismatches.
- Apply the same rules to both marketplace sold results and Cardsight pricing fallback searches.

## Validation
- Add focused checks for a detailed set whose sold title includes only the parent brand.
- Confirm wrong card numbers, players, years, brands, and variations remain excluded.
- Verify the app builds successfully.
