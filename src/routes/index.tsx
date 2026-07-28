import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ShoppingBag, ArrowRight, Search, DollarSign, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { analyzeProductGuest, searchWalmartMatches } from "@/lib/scan.functions";
import { identifyInput } from "@/lib/walmart";
import { saveGuestScan, guestUsed } from "@/lib/guest";
import { SearchResults, type Candidate } from "@/components/SearchResults";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NovaNest Scout — Walmart Product Research" },
      { name: "description", content: "Paste a Walmart product URL and get pricing, supplier, and profit analysis. Free guest scan available." },
      { property: "og:title", content: "NovaNest Scout" },
      { property: "og:description", content: "Walmart product research made simple — real numbers, clear verdicts." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchWarn, setSearchWarn] = useState<string | null>(null);
  const analyze = useServerFn(analyzeProductGuest);
  const search = useServerFn(searchWalmartMatches);

  async function runAnalyze(input: string) {
    if (guestUsed()) {
      toast.error("Free guest scan used. Sign up for unlimited scans.");
      router.navigate({ to: "/auth", search: { mode: "signup" } as never });
      return;
    }
    setLoading(true);
    try {
      const res = await analyze({ data: { input } });
      const scanId = crypto.randomUUID();
      saveGuestScan({
        id: scanId,
        input_url: input,
        normalized_url: res.normalized_url,
        walmart_item_id: res.itemId,
        product_data: res.product as never,
        analysis_status: res.product.title ? "retrieved" : "manual_required",
        created_at: new Date().toISOString(),
      });
      router.navigate({ to: "/guest-result" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function onScan() {
    if (loading) return;
    const id = identifyInput(url);
    if (!id.ok) { toast.error(id.error); return; }
    // Direct URL or item ID: scan immediately.
    if (id.kind === "url" || id.kind === "item_id") {
      setCandidates(null);
      await runAnalyze(url);
      return;
    }
    // UPC or keyword: fetch candidates first, let user select.
    setLoading(true);
    setSearchWarn(null);
    try {
      const r = await search({ data: { input: url } });
      if (r.kind === "direct") { await runAnalyze(r.url ?? url); return; }
      setCandidates(r.candidates);
      if (r.warning) setSearchWarn(r.warning);
      if (!r.candidates.length && !r.warning) setSearchWarn("No matches found. Try a Walmart URL or item ID.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none fixed inset-0 opacity-[0.05]" aria-hidden style={{ backgroundImage: "radial-gradient(circle at 15% 10%, oklch(0.6 0.22 27) 0, transparent 45%), radial-gradient(circle at 85% 90%, oklch(0.6 0.22 27) 0, transparent 45%)" }} />
      <header className="relative flex items-center justify-between px-4 py-4 md:px-10">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBag className="h-5 w-5" />
          </div>
          <span className="font-bold text-foreground">NovaNest Scout</span>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/auth" className="text-sm font-medium text-foreground hover:text-primary">Sign in</Link>
          <Button asChild size="sm"><Link to="/auth" search={{ mode: "signup" } as never}>Get started</Link></Button>
        </div>
      </header>

      <section className="relative mx-auto max-w-3xl px-4 pt-10 pb-16 text-center md:pt-20">
        <div className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-primary" /> Free guest scan — no signup required
        </div>
        <h1 className="mt-5 text-3xl font-bold tracking-tight text-foreground md:text-5xl">
          Research any <span className="text-primary">Walmart product</span> in seconds
        </h1>
        <p className="mt-3 text-muted-foreground md:text-lg">
          Paste a Walmart product URL. Get real pricing, supplier hooks, profit math, and a clear Buy / Review / Skip verdict.
        </p>

        <div className="mt-8 rounded-2xl border bg-card p-4 shadow-sm md:p-6">
          <label className="text-left block text-sm font-semibold text-foreground">
            Walmart URL, UPC / GTIN, item ID, or product keyword
            <span className="text-primary"> *</span>
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="walmart.com/ip/... · UPC · item ID · brand + model"
              className="h-12 rounded-xl text-base"
            />
            <Button onClick={onScan} disabled={loading || !url} size="lg" className="h-12 rounded-xl">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Find product
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground text-left">URLs and item IDs are analyzed directly. UPCs and keywords return candidate matches to pick from.</p>
        </div>

        {candidates !== null && (
          <div className="mt-6 text-left">
            {searchWarn && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{searchWarn}</div>}
            <SearchResults candidates={candidates} onSelect={(c) => c.url && runAnalyze(c.url)} loading={loading} />
          </div>
        )}

        <div className="mt-10 grid gap-3 text-left md:grid-cols-3">
          {[
            { icon: Search, title: "Fetch public data", desc: "We pull pricing, ratings, and product details from the Walmart listing." },
            { icon: DollarSign, title: "Calculate profit", desc: "Landed cost, marketplace fees, ROI, break-even — all in USD." },
            { icon: ShieldCheck, title: "Get a clear verdict", desc: "BUY, REVIEW, SKIP, or INSUFFICIENT DATA with the exact reasons." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="rounded-xl border bg-card p-4">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="h-4 w-4" />
              </div>
              <div className="mt-3 font-semibold text-foreground">{title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{desc}</div>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          <Link to="/glossary" className="hover:text-primary">Glossary</Link>
          <span>·</span>
          <Link to="/privacy" className="hover:text-primary">Privacy</Link>
          <span>·</span>
          <Link to="/terms" className="hover:text-primary">Terms</Link>
        </div>
        <div className="mt-6">
          <Link to="/auth" className="inline-flex items-center gap-1 text-sm font-medium text-primary">
            Have an account? Sign in <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
