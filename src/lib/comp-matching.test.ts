import { describe, expect, it } from "vitest";
import * as cardsight from "./cardsight.server";
import { scoreCompTitle, selectManageCompCandidates, selectValuationComps } from "./cardsight.server";
import { buildPt130SearchTiers, ebaySoldSearchUrl, ebaySoldSearchUrls, parseApifySoldListings } from "./pt130.server";

const ohtani = {
  player_name: "Shohei Ohtani",
  year: 2024,
  set_name: "Topps Series 2",
  card_number: "503",
};

const chrome = {
  player_name: "Yoshinobu Yamamoto",
  year: 2024,
  set_name: "Bowman Chrome",
  card_number: "BCP-40",
};

describe("scoreCompTitle levels", () => {
  it("accepts the exact card as exact", () => {
    expect(scoreCompTitle("2024 Topps Series 2 #503 Shohei Ohtani Dodgers", ohtani).level).toBe("exact");
  });

  it("does not require the first name", () => {
    expect(scoreCompTitle("2024 Topps #503 Ohtani Dodgers", ohtani).level).toBe("exact");
  });

  it("rejects a different player", () => {
    expect(scoreCompTitle("2024 Topps Series 2 #503 Aaron Judge", ohtani).level).toBe("reject");
  });

  it("treats an omitted card number as strong", () => {
    const score = scoreCompTitle("2024 Topps Series 2 Shohei Ohtani Dodgers", ohtani);
    expect(score.level).toBe("strong");
    expect(score.reasons).toContain("card number omitted");
  });

  it("rejects a conflicting card number", () => {
    expect(scoreCompTitle("2024 Topps Series 2 #17 Shohei Ohtani", ohtani).level).toBe("reject");
  });

  it("accepts short year forms", () => {
    expect(scoreCompTitle("'24 Topps Series 2 #503 Shohei Ohtani", ohtani).level).toBe("exact");
  });

  it("rejects the wrong year", () => {
    expect(scoreCompTitle("2019 Topps Series 2 #503 Shohei Ohtani", ohtani).level).toBe("reject");
  });

  it("rejects boxes, lots and breaks", () => {
    expect(scoreCompTitle("2024 Topps Series 2 Hobby Box Sealed", ohtani).level).toBe("reject");
    expect(scoreCompTitle("Lot of 10 2024 Topps Series 2 #503 Shohei Ohtani", ohtani).level).toBe("reject");
  });

  it("rejects a parallel when the card is a base card", () => {
    expect(scoreCompTitle("2024 Topps Series 2 #503 Shohei Ohtani Gold /2024", ohtani).level).toBe("reject");
  });
});

describe("product-level set identity", () => {
  it("does not let flagship Bowman price Bowman Chrome", () => {
    expect(scoreCompTitle("2024 Bowman #BCP-40 Yoshinobu Yamamoto", chrome).level).toBe("weak");
  });

  it("accepts the exact product", () => {
    expect(scoreCompTitle("2024 Bowman Chrome #BCP-40 Yoshinobu Yamamoto", chrome).level).toBe("exact");
  });

  it("matches Allen & Ginter written with an ampersand", () => {
    expect(
      scoreCompTitle("2024 Topps Allen & Ginter #123 Shohei Ohtani", {
        player_name: "Shohei Ohtani",
        year: 2024,
        set_name: "Topps Allen & Ginter",
        card_number: "123",
      }).level,
    ).toBe("exact");
  });
});

describe("card-number suffixes", () => {
  const sp = { player_name: "Jackson Merrill", year: 2024, set_name: "Topps Series 2", card_number: "112-SP" };

  it("matches 112-SP written with spaces", () => {
    expect(scoreCompTitle("2024 Topps Series 2 #112 SP Jackson Merrill", sp).level).toBe("exact");
  });

  it("rejects the plain 112 base card", () => {
    expect(scoreCompTitle("2024 Topps Series 2 #112 Jackson Merrill", sp).level).toBe("reject");
  });
});

describe("valuation selection", () => {
  const rows = [
    { title: "2024 Topps Series 2 #503 Shohei Ohtani", price: 10, sold_at: new Date().toISOString() },
    { title: "2024 Topps Series 2 #503 Shohei Ohtani", price: 12, sold_at: new Date().toISOString() },
    { title: "2024 Topps Series 2 #503 Shohei Ohtani", price: 14, sold_at: new Date().toISOString() },
  ];

  it("medians the qualified comps", () => {
    const result = selectValuationComps(rows, ohtani);
    expect(result.value).toBe(12);
    expect(result.comps).toHaveLength(3);
  });

  it("ignores player-only sales entirely", () => {
    const result = selectValuationComps(
      [
        { title: "2024 Panini Prizm #7 Shohei Ohtani", price: 500, sold_at: new Date().toISOString() },
        { title: "2024 Topps Chrome #100 Shohei Ohtani", price: 400, sold_at: new Date().toISOString() },
      ],
      ohtani,
    );
    expect(result.value).toBeNull();
    expect(result.comps).toHaveLength(0);
  });

  it("values a single verified comp instead of hiding it", () => {
    const result = selectValuationComps([rows[0]], ohtani);
    expect(result.value).toBe(10);
    expect(result.comps).toHaveLength(1);
  });

  it("keeps manual picks regardless of title", () => {
    const result = selectValuationComps(
      [
        { title: "Ohtani sweet card", price: 20, sold_at: new Date().toISOString(), is_manual: true },
        { title: "Ohtani other card", price: 30, sold_at: new Date().toISOString(), is_manual: true },
      ],
      ohtani,
    );
    expect(result.value).toBe(25);
  });

  it("does not blend graded comps into a raw card's value", () => {
    const result = selectValuationComps(
      [
        { title: "2024 Topps Series 2 #503 Shohei Ohtani", price: 10, sold_at: new Date().toISOString() },
        { title: "2024 Topps Series 2 #503 Shohei Ohtani", price: 12, sold_at: new Date().toISOString() },
        { title: "2024 Topps Series 2 #503 Shohei Ohtani PSA 10", price: 300, sold_at: new Date().toISOString() },
      ],
      ohtani,
    );
    expect(result.value).toBe(11);
  });
});

describe("valuation never uses player-only matching", () => {
  it("no longer exports looseCompMatch", () => {
    expect("looseCompMatch" in cardsight).toBe(false);
  });
});

const yamamotoBbm = {
  player_name: "Yoshinobu Yamamoto",
  year: 2021,
  set_name: "BBM 1st Version",
  card_number: "140",
};

describe("2021 BBM 1st Version #140 Yoshinobu Yamamoto", () => {
  it("keeps facsimile-auto as the standard printed card", () => {
    expect(
      scoreCompTitle(
        "YOSHINOBU YAMAMOTO 2021 BBM 1ST VERSION #140 FACSIMILE AUTO PRE DODGERS, MVP!",
        yamamotoBbm,
      ).level,
    ).toBe("exact");
  });

  it("keeps print-auto as the standard printed card", () => {
    expect(
      scoreCompTitle(
        "Yoshinobu Yamamoto 2021 BBM 1st Version Print Auto #140 Card LA Dodgers",
        yamamotoBbm,
      ).level,
    ).toBe("exact");
  });

  it("keeps the plain RC title", () => {
    expect(scoreCompTitle("Yoshinobu Yamamoto 2021 BBM 1st Version #140 RC", yamamotoBbm).level).toBe(
      "exact",
    );
  });

  it("still matches when the sold title omits the year", () => {
    expect(scoreCompTitle("Yoshinobu Yamamoto BBM 1st Version #140 FACSIMILE AUTO", yamamotoBbm).level).toBe(
      "exact",
    );
  });

  it("rejects a stated different year", () => {
    expect(scoreCompTitle("Yoshinobu Yamamoto 2022 BBM 1st Version #140", yamamotoBbm).level).toBe(
      "reject",
    );
  });

  it("still matches facsimile titles when the scan marked the card as an autograph", () => {
    expect(
      scoreCompTitle(
        "YOSHINOBU YAMAMOTO 2021 BBM 1ST VERSION #140 FACSIMILE AUTO PRE DODGERS, MVP!",
        { ...yamamotoBbm, is_autograph: true },
      ).level,
    ).toBe("exact");
  });

  it("still matches print-auto titles when the scan marked the card as an autograph", () => {
    expect(
      scoreCompTitle(
        "Yoshinobu Yamamoto 2021 BBM 1st Version Print Auto #140 Card LA Dodgers",
        { ...yamamotoBbm, is_autograph: true },
      ).level,
    ).toBe("exact");
  });

  it("rejects a real on-card auto for a non-auto vault card", () => {
    expect(
      scoreCompTitle("Yoshinobu Yamamoto 2021 BBM 1st Version #140 on card auto", yamamotoBbm).level,
    ).toBe("reject");
  });

  it("rejects 2nd Version of the same number", () => {
    expect(scoreCompTitle("Yoshinobu Yamamoto 2021 BBM 2nd Version #140", yamamotoBbm).level).toBe(
      "reject",
    );
  });

  it("keeps only identified listings when the scrape also returned junk", () => {
    const rows = [
      { title: "YOSHINOBU YAMAMOTO 2021 BBM 1ST VERSION #140 FACSIMILE AUTO", level: scoreCompTitle("YOSHINOBU YAMAMOTO 2021 BBM 1ST VERSION #140 FACSIMILE AUTO", yamamotoBbm).level },
      { title: "Yoshinobu Yamamoto 2021 BBM 2nd Version #140", level: scoreCompTitle("Yoshinobu Yamamoto 2021 BBM 2nd Version #140", yamamotoBbm).level },
      { title: "2021 Topps Chrome #50 Yoshinobu Yamamoto", level: scoreCompTitle("2021 Topps Chrome #50 Yoshinobu Yamamoto", yamamotoBbm).level },
      { title: "2021 BBM Yoshinobu Yamamoto lot of 10", level: scoreCompTitle("2021 BBM Yoshinobu Yamamoto lot of 10", yamamotoBbm).level },
    ];
    const shown = selectManageCompCandidates(rows);
    expect(shown).toHaveLength(1);
    expect(shown[0].title).toMatch(/1ST VERSION #140/i);
    expect(shown[0].level).toBe("exact");
  });

  it("shows unmatched listings when the matcher finds nothing", () => {
    const rows = [
      { title: "2021 Topps Chrome #50 Yoshinobu Yamamoto", level: scoreCompTitle("2021 Topps Chrome #50 Yoshinobu Yamamoto", yamamotoBbm).level },
      { title: "Yoshinobu Yamamoto 2021 BBM 2nd Version #140", level: scoreCompTitle("Yoshinobu Yamamoto 2021 BBM 2nd Version #140", yamamotoBbm).level },
    ];
    const shown = selectManageCompCandidates(rows);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.every((row) => row.level === "reject" || row.level === "weak")).toBe(true);
  });

  it("matches a listing that states set and number but omits the romanized name", () => {
    expect(
      scoreCompTitle("2021 BBM 1st Version #140 FACSIMILE AUTO", yamamotoBbm).level,
    ).toBe("strong");
  });
});

describe("eBay sold search URLs", () => {
  it("does not lock Japanese brands to the US Baseball Cards category", () => {
    const url = ebaySoldSearchUrl("2021 BBM 1st Version #140 Yoshinobu Yamamoto");
    expect(url).toContain("LH_Sold=1");
    expect(url).not.toContain("_sacat=");
  });

  it("also tries the US category as a second BBM URL", () => {
    const urls = ebaySoldSearchUrls("2021 BBM 1st Version #140 Yoshinobu Yamamoto");
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain("_sacat=26376");
  });

  it("keeps the US Baseball Cards category for Topps", () => {
    expect(ebaySoldSearchUrl("2024 Topps #503 Shohei Ohtani")).toContain("_sacat=26376");
  });

  const yamamotoSoldRow = {
    title: "YOSHINOBU YAMAMOTO 2021 BBM 1ST VERSION #140 FACSIMILE AUTO PRE DODGERS, MVP!",
    price: "$65.00",
    priceValue: 65,
    currency: "USD",
    sold: true,
    soldDate: "Sold  Aug 5, 2026",
    url: "https://www.ebay.com/itm/1",
  };

  it("reads sold rows out of Lovable's { data: [...] } gateway wrapper", () => {
    const sales = parseApifySoldListings({ data: [yamamotoSoldRow] });
    expect(sales).toHaveLength(1);
    expect(sales[0].price).toBe(65);
    expect(sales[0].title).toMatch(/YAMAMOTO/i);
  });

  it("reads sold rows out of { data: { items: [...] } }", () => {
    expect(parseApifySoldListings({ data: { items: [yamamotoSoldRow] } })).toHaveLength(1);
  });

  it("keeps the row when soldDate is missing but the listing has a price", () => {
    const { soldDate: _soldDate, ...row } = yamamotoSoldRow;
    expect(parseApifySoldListings({ data: [row] })).toHaveLength(1);
  });

  it("keeps completed-search rows even when the actor marks sold=false", () => {
    expect(parseApifySoldListings({
      data: [{ ...yamamotoSoldRow, sold: false, soldDate: undefined }],
    })).toHaveLength(1);
  });

  it("treats US$ as USD", () => {
    expect(parseApifySoldListings({
      data: [{ ...yamamotoSoldRow, currency: "US $" }],
    })).toHaveLength(1);
  });

  it("keeps a nested title when the top-level title is null", () => {
    const sales = parseApifySoldListings({
      data: [{
        title: null,
        price: "$50.00",
        priceValue: 50,
        currency: "USD",
        sold: true,
        basic_info: {
          title: "YOSHINOBU YAMAMOTO 2021 BBM 1ST VERSION #140 FACSIMILE AUTO",
        },
        url: "https://www.ebay.com/itm/2",
      }],
    });
    expect(sales).toHaveLength(1);
    expect(sales[0].title).toMatch(/YAMAMOTO/i);
  });

  it("is the live production failure: wrapped payload is not an array", () => {
    const wrapped = { data: [yamamotoSoldRow] };
    expect(Array.isArray(wrapped)).toBe(false);
    expect(parseApifySoldListings(wrapped as unknown as unknown[])).toHaveLength(1);
  });

  // Searches are identity-only: eBay ranks by keyword relevance, so trait words
  // pull in other players' parallels. Traits are enforced in verification.
  it("keeps autograph wording out of the search words", () => {
    const tiers = buildPt130SearchTiers({
      year: 2021,
      set_name: "BBM 1st Version",
      card_number: "140",
      player_name: "Yoshinobu Yamamoto",
      is_autograph: true,
    });
    expect(tiers.primary).toBe("2021 BBM 1st Version #140 Yoshinobu Yamamoto");
  });

  it("keeps the parallel name and serial denominator out of the search words", () => {
    const tiers = buildPt130SearchTiers({
      year: 2024,
      set_name: "Topps Chrome",
      card_number: "150",
      player_name: "Elly De La Cruz",
      selected_parallel_name: "Red Refractor /5",
      serial_number: "3/5",
    });
    expect(tiers.primary).toBe("2024 Topps Chrome #150 Elly De La Cruz");
  });

  it("broadening tiers drop the card number and narrow to the parent brand", () => {
    const tiers = buildPt130SearchTiers({
      year: 2024,
      set_name: "Bowman Sterling",
      card_number: "BSR-40",
      player_name: "Roki Sasaki",
    });
    expect(tiers.noNumber).toBe("2024 Bowman Sterling Roki Sasaki");
    expect(tiers.brand).toBe("2024 Bowman #BSR 40 Roki Sasaki");
  });
});
