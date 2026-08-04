export const APPROVED_CARD_SETS = [
  "Topps",
  "Topps Series 1",
  "Topps Series 2",
  "Topps Update",
  "Topps Complete/Factory Sets",
  "Topps Chrome",
  "Topps Chrome Update",
  "Topps Chrome Black",
  "Topps Chrome Platinum",
  "Topps Chrome Sapphire",
  "Bowman",
  "Bowman Chrome",
  "Bowman Draft",
  "Bowman Sapphire",
  "Bowman Sterling",
  "Bowman's Best",
  "Bowman Platinum",
  "Bowman Heritage",
  "Bowman Inception",
  "Bowman Chrome Sapphire",
  "Topps Heritage",
  "Topps Heritage High Number",
  "Topps Archives",
  "Topps Stadium Club",
  "Topps Allen & Ginter",
  "Topps Finest",
  "Topps Pristine",
  "Topps Tribute",
  "Topps Tier One",
  "Topps Dynasty",
  "Topps Five Star",
  "Topps Inception",
  "Topps Sterling",
  "Topps Now",
  "Topps Black and White",
  "Topps Gold Label",
  "Topps NPB",
  "Topps NPB Chrome",
  "Topps NPB Stadium Club",
  "Topps NPB Finest",
  "Topps Bowman NPB",
  "Topps NPB 206",
  "Panini",
  "Donruss",
  "Donruss Optic",
  "Prizm",
  "Select",
  "National Treasures",
  "Flawless",
  "Immaculate Collection",
  "Chronicles",
  "Contenders / Contenders Draft Picks",
  "Stars & Stripes",
  "Three and Two",
  "Boys of Summer",
  "Diamond Kings",
  "Absolute",
  "Prospect Edition",
  "Elite Extra Edition",
  "BBM",
  "BBM 1st Version",
  "BBM 2nd Version",
  "BBM Fusion",
  "BBM Rookie Edition",
  "BBM Draft",
  "BBM Team Sets",
  "BBM Premium / Genesis",
  "BBM Glory",
  "BBM Infinity",
  "BBM Icons",
  "BBM Crown",
  "BBM Special / Theme Sets",
  "Epoch",
  "Epoch NPB",
  "Epoch NPB Luxury Collection",
  "Epoch Team Premier Edition",
  "Epoch Stars & Legends",
  "Epoch Rookie Sets",
  "Epoch OB Club / Holographica",
  "Epoch Team Sets",
  "Calbee",
] as const;

export type ApprovedCardSet = (typeof APPROVED_CARD_SETS)[number];

const SET_ALIASES: Record<string, ApprovedCardSet> = {
  "topps black white": "Topps Black and White",
  "topps black and white": "Topps Black and White",
  "topps b w": "Topps Black and White",
  "topps bw": "Topps Black and White",
  "topps complete set": "Topps Complete/Factory Sets",
  "topps complete sets": "Topps Complete/Factory Sets",
  "topps factory set": "Topps Complete/Factory Sets",
  "topps factory sets": "Topps Complete/Factory Sets",
  "topps allen ginter": "Topps Allen & Ginter",
  "allen ginter": "Topps Allen & Ginter",
  "allen and ginter": "Topps Allen & Ginter",
  "topps allen and ginter": "Topps Allen & Ginter",
  "contenders": "Contenders / Contenders Draft Picks",
  "contenders draft picks": "Contenders / Contenders Draft Picks",
  "panini contenders": "Contenders / Contenders Draft Picks",
  "panini contenders draft picks": "Contenders / Contenders Draft Picks",
  "panini prizm": "Prizm",
  "panini select": "Select",
  "panini chronicles": "Chronicles",
  "panini flawless": "Flawless",
  "panini national treasures": "National Treasures",
  "panini immaculate": "Immaculate Collection",
  "panini immaculate collection": "Immaculate Collection",
  "panini three and two": "Three and Two",
  "panini three & two": "Three and Two",
  "panini boys of summer": "Boys of Summer",
  "panini diamond kings": "Diamond Kings",
  "panini absolute": "Absolute",
  "elite extra edition": "Elite Extra Edition",
  "panini elite extra edition": "Elite Extra Edition",
  "bbm rookie edition draft": "BBM Rookie Edition",
  "bbm rookie edition": "BBM Rookie Edition",
  "bbm rookie": "BBM Rookie Edition",
  "bbm draft": "BBM Draft",
  "bbm genesis": "BBM Premium / Genesis",
  "bbm premium": "BBM Premium / Genesis",
  "bbm theme": "BBM Special / Theme Sets",
  "bbm special": "BBM Special / Theme Sets",
  "epoch npb": "Epoch NPB",
  "epoch luxury": "Epoch NPB Luxury Collection",
  "epoch premier": "Epoch Team Premier Edition",
  "epoch stars and legends": "Epoch Stars & Legends",
  "epoch rookie": "Epoch Rookie Sets",
  "epoch ob club": "Epoch OB Club / Holographica",
  "epoch holographica": "Epoch OB Club / Holographica",
  "topps npb": "Topps NPB",
  "topps npb chrome": "Topps NPB Chrome",
  "topps npb stadium club": "Topps NPB Stadium Club",
  "topps npb finest": "Topps NPB Finest",
  "topps bowman npb": "Topps Bowman NPB",
  "topps bowman npb 206": "Topps NPB 206",
  "topps npb 206": "Topps NPB 206",
  "bowman sterling": "Bowman Sterling",
  "topps bowman sterling": "Bowman Sterling",
  "bowman sterling continuity": "Bowman Sterling",
  "bowmans best": "Bowman's Best",
  "bowman best": "Bowman's Best",
  "topps bowmans best": "Bowman's Best",
  "bowman platinum": "Bowman Platinum",
  "bowman heritage": "Bowman Heritage",
  "bowman inception": "Bowman Inception",
  "bowman chrome sapphire": "Bowman Chrome Sapphire",
  "bowman sapphire edition": "Bowman Sapphire",
};

// Card-number prefixes that identify the set even when the front only shows the
// brand logo (e.g. "#BSR-40" is Bowman Sterling Rookie, not plain Bowman).
// Longest prefixes first so BSR wins over BS.
const CARD_NUMBER_SET_CODES: Array<[string, string]> = [
  ["BSRA", "Bowman Sterling"],
  ["BSPA", "Bowman"],
  ["BSR", "Bowman Sterling"],
  ["BSA", "Bowman Sterling"],
  ["BST", "Bowman Sterling"],
  ["BBA", "Bowman's Best"],
  ["BB", "Bowman's Best"],
  ["BCP", "Bowman Chrome"],
  ["BDC", "Bowman Draft"],
  ["BDP", "Bowman Draft"],
  ["BP", "Bowman"],
  ["BI", "Bowman Inception"],
];

/**
 * Infers the set from a printed card number prefix. Returns null when the
 * prefix is unknown or the number is purely numeric.
 */
export function setFromCardNumber(cardNumber: string | null | undefined): string | null {
  const raw = String(cardNumber ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  const prefix = raw.match(/^[A-Z]+/)?.[0];
  if (!prefix) return null;
  for (const [code, set] of CARD_NUMBER_SET_CODES) {
    if (prefix === code) return set;
  }
  return null;
}

function normalizeSetText(value: string | number | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const APPROVED_LOOKUP = new Map(APPROVED_CARD_SETS.map((set) => [normalizeSetText(set), set]));

export function isApprovedCardSet(value: string | null | undefined): value is ApprovedCardSet {
  return APPROVED_CARD_SETS.includes(value as ApprovedCardSet);
}

function titleCase(normalized: string): string {
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// Brands outside this curated list (Upper Deck, Fleer, Ultra, Score, Leaf,
// etc.) used to be dropped entirely — toApprovedCardSet returned null and
// callers persisted that null, wiping set_name on save even though the
// pricing query builder (setBrand() below) still expects those brands to be
// present. Falling back to a normalized version of the raw text instead of
// null keeps the set filter alive for uncatalogued brands and degrades
// gracefully as new brands appear, instead of requiring this whitelist to be
// kept in lockstep with Cardsight's catalog.
export function toApprovedCardSet(...parts: Array<string | number | null | undefined>): string | null {
  const raw = parts.filter(Boolean).join(" ");
  const normalized = normalizeSetText(raw);
  if (!normalized) return null;

  const exact = APPROVED_LOOKUP.get(normalized) ?? SET_ALIASES[normalized];
  if (exact) return exact;

  const ordered = [...APPROVED_CARD_SETS].sort((a, b) => normalizeSetText(b).length - normalizeSetText(a).length);
  for (const set of ordered) {
    const setNorm = normalizeSetText(set);
    if (normalized.includes(setNorm)) return set;
  }

  return titleCase(normalized);
}
// ---------------------------------------------------------------------------
// Grouping helper for analytics ("Sets by count").
//
// Card set_name values arrive from several sources (Cardsight, GPT fallback,
// manual edits) so the same physical set shows up under multiple spellings:
// "Topps Black & White", "Topps Black and White", "Topps B&W Rookie
// Resolution", "Topps Black & White - Frame Rate". Counting raw strings splits
// one 5-card set into four rows. baseSetName() collapses spelling variants,
// parentheticals, subset suffixes and "Base Set" filler onto one label.
// ---------------------------------------------------------------------------
const SET_FILLER = /\b(base set|base|complete set|set)\b/g;

export function baseSetName(value: string | null | undefined): string | null {
  let normalized = normalizeSetText(value);
  if (!normalized) return null;

  // Strip parentheticals such as "(Custom/Art Card)" before normalizing wiped
  // the brackets, then subset suffixes after a dash.
  normalized = normalized
    .replace(/\bcustom\b|\bart card\b/g, " ")
    .replace(/\bb (and )?w\b/g, "black and white")
    .replace(/\s+/g, " ")
    .trim();

  const alias = APPROVED_LOOKUP.get(normalized) ?? SET_ALIASES[normalized];
  if (alias) return alias;

  // Prefer the longest approved multi-word set contained in the name, so
  // "Topps B&W Rookie Resolution" lands on "Topps Black and White" instead of
  // the bare "Topps" brand.
  const ordered = [...APPROVED_CARD_SETS].sort(
    (a, b) => normalizeSetText(b).length - normalizeSetText(a).length,
  );
  for (const set of ordered) {
    const setNorm = normalizeSetText(set);
    if (setNorm.split(" ").length < 2) continue;
    if (normalized.includes(setNorm)) return set;
  }

  const stripped = normalized.replace(SET_FILLER, " ").replace(/\s+/g, " ").trim();
  if (!stripped) return titleCase(normalized);

  const strippedAlias = APPROVED_LOOKUP.get(stripped) ?? SET_ALIASES[stripped];
  if (strippedAlias) return strippedAlias;

  return titleCase(stripped);
}
