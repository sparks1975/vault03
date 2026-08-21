// Catalog of recognized baseball card products, grouped by brand. This list is
// what card identification is allowed to return for set_name, so it needs to
// cover every product a collector can plausibly own from Topps, Bowman,
// Panini/Donruss, BBM, Epoch and Calbee. Parallels, inserts and autograph
// subsets are NOT sets — they live on the parallel/serial fields.
export const APPROVED_CARD_SETS = [
  // ---- Topps (flagship + Chrome family) ----
  "Topps",
  "Topps Series 1",
  "Topps Series 2",
  "Topps Update",
  "Topps Complete/Factory Sets",
  "Topps Opening Day",
  "Topps Big League",
  "Topps Total",
  "Topps Holiday",
  "Topps Chrome",
  "Topps Chrome Update",
  "Topps Chrome Black",
  "Topps Chrome Platinum",
  "Topps Chrome Sapphire",
  "Topps Chrome Logo Acetate",
  "Topps Chrome Cosmic",
  // ---- Topps (retro / heritage lines) ----
  "Topps Heritage",
  "Topps Heritage High Number",
  "Topps Heritage Minor League",
  "Topps Archives",
  "Topps Archives Signature Series",
  "Topps Gallery",
  "Topps Gypsy Queen",
  "Topps Allen & Ginter",
  "Topps Allen & Ginter Chrome",
  "Topps 206",
  "Topps T87",
  "Topps Turkey Red",
  "Topps Stadium Club",
  "Topps Stadium Club Chrome",
  "Topps Fire",
  "Topps Big League Baseball",
  // ---- Topps (high end) ----
  "Topps Finest",
  "Topps Finest Flashbacks",
  "Topps Pristine",
  "Topps Tribute",
  "Topps Tier One",
  "Topps Dynasty",
  "Topps Dynasty Black",
  "Topps Five Star",
  "Topps Inception",
  "Topps Sterling",
  "Topps Museum Collection",
  "Topps Definitive Collection",
  "Topps Diamond Icons",
  "Topps Transcendent",
  "Topps Luminaries",
  "Topps Triple Threads",
  "Topps Gold Label",
  "Topps Gold Label Black",
  "Topps Clearly Authentic",
  "Topps Chrome Sonic",
  // ---- Topps (online / limited print-to-order) ----
  "Topps Now",
  "Topps Black and White",
  "Topps Project 2020",
  "Topps Project70",
  "Topps Project Vault",
  "Topps Living Set",
  "Topps Game Within the Game",
  "Topps X",
  "Topps Throwback Thursday",
  "Topps Chrome Black Friday",
  "Topps Update Chrome",
  // ---- Topps NPB / international ----
  "Topps NPB",
  "Topps NPB Chrome",
  "Topps NPB Stadium Club",
  "Topps NPB Finest",
  "Topps Bowman NPB",
  "Topps NPB 206",
  "Topps NPB Heritage",
  "Topps NPB Update",
  "Topps WBC",
  // ---- Bowman ----
  "Bowman",
  "Bowman Chrome",
  "Bowman Chrome Sapphire",
  "Bowman Draft",
  "Bowman Draft Chrome",
  "Bowman Draft Sapphire",
  "Bowman Sapphire",
  "Bowman Sterling",
  "Bowman's Best",
  "Bowman Platinum",
  "Bowman Heritage",
  "Bowman Inception",
  "Bowman Transcendent",
  "Bowman Chrome Ascension",
  "Bowman Chrome HTA",
  "Bowman Chrome Mega Box",
  "Bowman Best of 2024",
  "Bowman University",
  "Bowman Sterling Continuity",
  // ---- Panini / Donruss ----
  "Panini",
  "Donruss",
  "Donruss Optic",
  "Donruss Elite",
  "Prizm",
  "Prizm Draft Picks",
  "Select",
  "Select Draft Picks",
  "Mosaic",
  "Obsidian",
  "Spectra",
  "Phoenix",
  "Certified",
  "Limited",
  "Prestige",
  "Score",
  "Playbook",
  "Origins",
  "Chronicles",
  "Chronicles Draft Picks",
  "National Treasures",
  "National Treasures Collegiate",
  "Flawless",
  "Immaculate Collection",
  "Contenders / Contenders Draft Picks",
  "Stars & Stripes",
  "Three and Two",
  "Boys of Summer",
  "Diamond Kings",
  "Absolute",
  "Prospect Edition",
  "Elite Extra Edition",
  "Leaf",
  "Leaf Metal",
  "Leaf Draft",
  "Leaf Trinity",
  "Leaf Flash",
  "Leaf Perfect Game",
  "Leaf Valiant",
  // ---- BBM (Japan) ----
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
  "BBM Achievement",
  "BBM Legend",
  "BBM True Heart",
  "BBM Historic Collection",
  "BBM Classic",
  "BBM All-Star",
  "BBM Nippon Series",
  "BBM Ballpark Legends",
  "BBM Special / Theme Sets",
  // ---- Epoch (Japan) ----
  "Epoch",
  "Epoch NPB",
  "Epoch NPB Premier Edition",
  "Epoch NPB Luxury Collection",
  "Epoch Team Premier Edition",
  "Epoch Stars & Legends",
  "Epoch Rookie Sets",
  "Epoch OB Club / Holographica",
  "Epoch Team Sets",
  "Epoch One",
  "Epoch Premier Collection",
  "Epoch Authentic",
  "Epoch Legendary",
  "Epoch Japan National Team",
  // ---- Calbee (Japan) ----
  "Calbee",
  "Calbee Series 1",
  "Calbee Series 2",
  "Calbee Series 3",
  "Calbee Star Card",
  "Calbee Golden Glove",
  "Calbee Title Holder",
  "Calbee Home Run King",
  "Calbee Legend",
  // ---- Upper Deck ----
  "Upper Deck",
  "Upper Deck Series 1",
  "Upper Deck Series 2",
  "Upper Deck Collector's Choice",
  "Upper Deck SP",
  "Upper Deck SP Authentic",
  "Upper Deck SP Legendary Cuts",
  "Upper Deck SPx",
  "Upper Deck Sweet Spot",
  "Upper Deck Ultimate Collection",
  "Upper Deck Exquisite Collection",
  "Upper Deck Premier",
  "Upper Deck Masterpieces",
  "Upper Deck Artifacts",
  "Upper Deck Goudey",
  "Upper Deck Vintage",
  "Upper Deck Legends",
  "Upper Deck Heroes",
  "Upper Deck Star Rookies",
  "Upper Deck Pro View",
  "Upper Deck Black Diamond",
  "Upper Deck Ovation",
  "Upper Deck Victory",
  "Upper Deck MVP",
  "Upper Deck Ballpark Collection",
  "Upper Deck Signature Stars",
  "Upper Deck First Pitch",
  "Upper Deck Future Stars",
  "Upper Deck A Piece of History",
  "Upper Deck Icons",
  "Upper Deck Spectrum",
  "Upper Deck Documentary",
  "Upper Deck USA Baseball",
  "Upper Deck Minor League",
  "Upper Deck Prospect Premieres",
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
  // Brand-less spellings collectors and marketplace titles use.
  "gypsy queen": "Topps Gypsy Queen",
  "stadium club": "Topps Stadium Club",
  "opening day": "Topps Opening Day",
  "big league": "Topps Big League",
  "museum collection": "Topps Museum Collection",
  "definitive collection": "Topps Definitive Collection",
  "triple threads": "Topps Triple Threads",
  "diamond icons": "Topps Diamond Icons",
  "tier one": "Topps Tier One",
  "five star": "Topps Five Star",
  "gold label": "Topps Gold Label",
  "turkey red": "Topps Turkey Red",
  "living set": "Topps Living Set",
  "topps living": "Topps Living Set",
  "project 70": "Topps Project70",
  "topps project 70": "Topps Project70",
  "project 2020": "Topps Project 2020",
  "heritage high number": "Topps Heritage High Number",
  "heritage minors": "Topps Heritage Minor League",
  "topps heritage minors": "Topps Heritage Minor League",
  "archives signature": "Topps Archives Signature Series",
  "world baseball classic": "Topps WBC",
  "topps world baseball classic": "Topps WBC",
  // Bowman
  "bowman chrome hta": "Bowman Chrome HTA",
  "bowman chrome mega": "Bowman Chrome Mega Box",
  "bowman best": "Bowman's Best",
  "bowmans best": "Bowman's Best",
  "bowman draft chrome": "Bowman Draft Chrome",
  // Panini / Donruss / Leaf
  "panini mosaic": "Mosaic",
  "panini obsidian": "Obsidian",
  "panini spectra": "Spectra",
  "panini phoenix": "Phoenix",
  "panini certified": "Certified",
  "panini limited": "Limited",
  "panini prestige": "Prestige",
  "panini score": "Score",
  "panini playbook": "Playbook",
  "panini origins": "Origins",
  "panini donruss": "Donruss",
  "panini donruss optic": "Donruss Optic",
  "panini donruss elite": "Donruss Elite",
  "donruss optic prizm": "Donruss Optic",
  "panini prizm draft": "Prizm Draft Picks",
  "prizm draft": "Prizm Draft Picks",
  "select draft": "Select Draft Picks",
  "panini select draft picks": "Select Draft Picks",
  "panini chronicles draft picks": "Chronicles Draft Picks",
  "panini stars and stripes": "Stars & Stripes",
  "panini prospect edition": "Prospect Edition",
  "leaf metal draft": "Leaf Metal",
  "leaf draft picks": "Leaf Draft",
  // BBM / Epoch / Calbee
  "bbm 1st": "BBM 1st Version",
  "bbm 2nd": "BBM 2nd Version",
  "bbm nippon series": "BBM Nippon Series",
  "bbm all star": "BBM All-Star",
  "bbm historic": "BBM Historic Collection",
  "epoch one": "Epoch One",
  "epoch npb premier": "Epoch NPB Premier Edition",
  "epoch premier collection": "Epoch Premier Collection",
  "epoch japan national team": "Epoch Japan National Team",
  "calbee series 1": "Calbee Series 1",
  "calbee series 2": "Calbee Series 2",
  "calbee series 3": "Calbee Series 3",
  "calbee star": "Calbee Star Card",
  "calbee golden glove": "Calbee Golden Glove",
  "calbee title holder": "Calbee Title Holder",
  "calbee home run king": "Calbee Home Run King",
  "bowman sterling": "Bowman Sterling",
  "topps bowman sterling": "Bowman Sterling",
  "topps bowmans best": "Bowman's Best",
  "bowman platinum": "Bowman Platinum",
  "bowman heritage": "Bowman Heritage",
  "bowman inception": "Bowman Inception",
  "bowman chrome sapphire": "Bowman Chrome Sapphire",
  "bowman sapphire edition": "Bowman Sapphire",
  // Upper Deck
  "ud": "Upper Deck",
  "upper deck baseball": "Upper Deck",
  "collectors choice": "Upper Deck Collector's Choice",
  "upper deck collectors choice": "Upper Deck Collector's Choice",
  "sp authentic": "Upper Deck SP Authentic",
  "ud sp authentic": "Upper Deck SP Authentic",
  "sp legendary cuts": "Upper Deck SP Legendary Cuts",
  "spx": "Upper Deck SPx",
  "upper deck spx": "Upper Deck SPx",
  "sweet spot": "Upper Deck Sweet Spot",
  "ultimate collection": "Upper Deck Ultimate Collection",
  "exquisite collection": "Upper Deck Exquisite Collection",
  "upper deck exquisite": "Upper Deck Exquisite Collection",
  "masterpieces": "Upper Deck Masterpieces",
  "artifacts": "Upper Deck Artifacts",
  "goudey": "Upper Deck Goudey",
  "upper deck black diamond": "Upper Deck Black Diamond",
  "black diamond": "Upper Deck Black Diamond",
  "upper deck ud premier": "Upper Deck Premier",
  "a piece of history": "Upper Deck A Piece of History",
  "piece of history": "Upper Deck A Piece of History",
  "upper deck usa": "Upper Deck USA Baseball",
  "usa baseball": "Upper Deck USA Baseball",
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

/**
 * Returns the marketplace-facing brand for a catalog set. Valuation searches
 * should use this broad label rather than a release/subset name sellers may
 * omit (for example, "Bowman Sterling" becomes "Bowman").
 */
export function cardSetBrand(value: string | null | undefined): string | null {
  const normalized = normalizeSetText(value);
  if (!normalized) return null;

  const brands: Array<[RegExp, string]> = [
    [/\bbowman\b/, "Bowman"],
    [/\btopps\b/, "Topps"],
    [/\b(bb[m]?|baseball magazine)\b/, "BBM"],
    [/\bepoch\b/, "Epoch"],
    [/\bcalbee\b/, "Calbee"],
    [/\bupper deck\b|\bud\b/, "Upper Deck"],
    [/\bdonruss\b/, "Donruss"],
    [/\bpanini\b/, "Panini"],
    [/\bprizm\b/, "Prizm"],
    [/\bselect\b/, "Select"],
    [/\bfleer\b/, "Fleer"],
    [/\bultra\b/, "Ultra"],
    [/\bleaf\b/, "Leaf"],
  ];
  return brands.find(([pattern]) => pattern.test(normalized))?.[1] ?? normalized.split(" ")[0] ?? null;
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
