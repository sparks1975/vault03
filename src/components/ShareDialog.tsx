import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Share2, Copy, Check, Loader2, X } from "lucide-react";
import { getShareSettings, updateShareSettings } from "@/lib/share.functions";

export function ShareDialog() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [slug, setSlug] = useState("");
  const [copied, setCopied] = useState(false);

  const getFn = useServerFn(getShareSettings);
  const updateFn = useServerFn(updateShareSettings);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getFn()
      .then((s) => {
        // Default sharing to ON the first time the dialog is opened.
        // If a slug already exists, respect the saved preference.
        const firstTime = !s.share_slug && !s.is_public;
        setIsPublic(firstTime ? true : s.is_public);
        setSlug(s.share_slug ?? "");
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open, getFn]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = slug ? `${origin}/s/${slug}` : "";

  async function save(nextPublic: boolean, nextSlug?: string) {
    setSaving(true);
    try {
      const res = await updateFn({
        data: {
          is_public: nextPublic,
          share_slug: nextSlug !== undefined ? nextSlug : slug || null,
        },
      });
      setIsPublic(res.is_public);
      setSlug(res.share_slug ?? "");
      toast.success(nextPublic ? "Sharing enabled" : "Sharing disabled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleToggle() {
    if (!isPublic) {
      if (!slug || slug.trim().length < 3) {
        toast.error("Choose a link name first (3+ chars).");
        return;
      }
      await save(true, slug.trim());
    } else {
      await save(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Share collection"
        className="px-3 md:px-4 py-2 border border-border text-foreground text-xs font-bold uppercase tracking-widest rounded-sm hover:bg-secondary transition-colors inline-flex items-center gap-2"
      >
        <Share2 className="size-3.5" />
        <span className="hidden sm:inline">Share</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background border border-border w-full max-w-md p-6 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setOpen(false)}
              className="absolute top-3 right-3 p-1 hover:bg-secondary rounded-sm"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>

            <h2 className="text-lg font-bold mb-1">Share your collection</h2>
            <p className="text-xs text-muted-foreground mb-6">
              Anyone with the link can view your cards and values. Purchase price stays private.
            </p>

            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <label className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
                  Your link name
                </label>
                <div className="flex items-center border border-border">
                  <span className="px-3 text-xs text-muted-foreground bg-secondary py-2 border-r border-border">
                    vault.03/s/
                  </span>
                  <input
                    value={slug}
                    onChange={(e) =>
                      setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))
                    }
                    placeholder="your-name"
                    className="flex-1 px-3 py-2 bg-background text-sm focus:outline-none"
                    maxLength={40}
                  />
                </div>

                <div className="flex items-center justify-between mt-6">
                  <div>
                    <p className="text-sm font-medium">Public sharing</p>
                    <p className="text-xs text-muted-foreground">
                      {isPublic ? "Anyone with the link can view" : "Link is disabled"}
                    </p>
                  </div>
                  <button
                    onClick={handleToggle}
                    disabled={saving}
                    className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors ${
                      isPublic ? "bg-accent" : "bg-secondary border border-border"
                    } disabled:opacity-60`}
                    aria-pressed={isPublic}
                  >
                    <span
                      className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-background border border-border transition-transform ${
                        isPublic ? "translate-x-6" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {isPublic && shareUrl && (
                  <div className="mt-6 border border-border p-3 bg-secondary/40">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-2">
                      Shareable link
                    </p>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={shareUrl}
                        className="flex-1 px-2 py-1.5 text-xs bg-background border border-border font-mono truncate"
                      />
                      <button
                        onClick={handleCopy}
                        className="px-3 py-1.5 border border-border hover:bg-secondary inline-flex items-center gap-1 text-xs font-bold uppercase tracking-widest"
                      >
                        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
