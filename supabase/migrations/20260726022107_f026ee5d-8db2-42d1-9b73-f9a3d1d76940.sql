ALTER TABLE public.card_sales
ADD COLUMN IF NOT EXISTS title text;

-- Known bad comp reported by a user: this is a sealed factory box, not a single card.
DELETE FROM public.card_sales
WHERE url ILIKE '%375806070899%';

-- Remove any previously stored rows where the source field already contains
-- obvious sealed/multi-item listing language. Future rows store the actual
-- listing title and are filtered before insertion.
DELETE FROM public.card_sales
WHERE source ~* '\m(case break|player break|team break|group break|box break|factory sealed|sealed (wax|box|case|pack|packs|product)|unopened|hobby (box|case|pack|packs)|jumbo (box|pack|packs)|blaster (box|pack|packs)|retail (box|pack|packs)|mega box|hanger (box|pack|packs)|value box|cello (box|pack|packs)|wax (box|pack|packs)|complete set|factory set|master set|team set|lot of [0-9]+|card lot|[0-9]+ card lot|repack|mixer)\M';