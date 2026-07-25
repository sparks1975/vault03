## Goal
Monetize the app with **one tasteful EthicalAds unit on public shared collection pages only** (`/s/:slug`). The authenticated app stays ad-free, which sets up a future "free tier with ads → paid tier ad-free" model without any refactor.

Why EthicalAds: no tracking, no creepy retargeting, dev/collector-friendly creatives, and it fits the collector-grade aesthetic. Carbon Ads is an alternative but is invite-only and heavily oversubscribed — EthicalAds is the realistic path to get running now.

## What ships

1. **Signup step (user, out of band)** — you apply to EthicalAds at https://www.ethicalads.io/publishers/ and get a `publisher id`. Nothing to build until that's approved. I'll note this clearly and pause implementation there if the ID isn't ready.

2. **Ad component** — `src/components/EthicalAd.tsx`
   - Renders the standard EthicalAds `<div data-ea-publisher="…" data-ea-type="image" data-ea-style="fixedfooter">` (or `image` inline — see Placement below).
   - Loads `https://media.ethicalads.io/media/client/ethicalads.min.js` once, lazily, only when the component mounts.
   - No-ops in dev (checks `import.meta.env.PROD`) so we don't hit their network during local work.
   - Adds a tiny "Ad" eyebrow label so it's clearly disclosed.

3. **Placement** — `src/routes/s.$slug.tsx` only
   - One inline `image` ad slot inserted **after the header stats block, before the card grid**, centered, with the same border/tracking styling as the rest of the shared page so it feels native.
   - Nothing on `/dashboard`, `/`, `/auth`, or any authenticated route.

4. **CSP / script allowance**
   - Confirm no CSP header blocks `media.ethicalads.io` and `server.ethicalads.io`. We don't currently set a strict CSP, so this should just work; I'll verify in the built HTML/headers before finishing.

5. **Config**
   - Publisher ID lives in `.env` as `VITE_ETHICALADS_PUBLISHER_ID` (publishable, safe in client bundle). Component renders nothing when it's absent, so the app is safe to ship before approval.

## Explicitly NOT in this plan
- No AdSense, no Mediavine/Ezoic/Raptive.
- No ads on authenticated routes.
- No paid tier / Stripe work yet — this plan just keeps the door open for it by scoping ads to the free/public surface.
- No affiliate links on comps.

## Technical notes
- EthicalAds script is ~4KB and self-contained; loading it only on `/s/:slug` keeps the main app bundle untouched.
- Loader guards against double-injection across client-side navigations by checking `window.ethicalads` / an existing `<script>` tag, and calls `window.ethicalads?.load()` on mount so navigating between shared pages re-fills the slot.
- OG image and share metadata on `/s/:slug` are unchanged.

## Rollout
1. You apply to EthicalAds and share the publisher ID (or add it as `VITE_ETHICALADS_PUBLISHER_ID` in project env).
2. I implement the component + placement.
3. Verify in preview: ad renders on `/s/:slug`, does not render on `/dashboard`, no console/network errors, layout unaffected on mobile.
