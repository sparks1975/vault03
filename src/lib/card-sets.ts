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
] as const;

export type ApprovedCardSet = (typeof APPROVED_CARD_SETS)[number];

const SET_ALIASES: Record<string, ApprovedCardSet> = {
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
};

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

export function toApprovedCardSet(...parts: Array<string | number | null | undefined>): ApprovedCardSet | null {
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

  return null;
}