import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { analyzeProductGuest } from "@/lib/scan.functions";
import type { ProductData } from "@/lib/walmart";
import type { AmazonProduct } from "@/lib/amazon";
import { extractAsin, buildAmazonUrl } from "@/lib/amazon";
import { walmartToOffer, amazonToOffer, compareOffers } from "@/lib/compare";
import { CompareCard } from "@/components/CompareCard";
import { CompareSummary } from "@/components/CompareSummary";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShoppingBag, Info, Search, Wand2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/compare")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Amazon vs Walmart — NovaNest Scout" },
      {
        name: "description",
        content:
          "Side-by-side price, rating, and review comparison for any product on Walmart vs Amazon.",
      },
      { property: "og:title", content: "Amazon vs Walmart comparison" },
      {
        property: "og:description",
        content:
          "Compare Walmart and Amazon prices, ratings, and reviews side by side to find the better value.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ComparePage,
});

const TOWEL_SEARCH = "https://www.walmart.com/search?q=6+piece+bath+towel+set";

function ComparePage() {
  const analyze = useServerFn(analyzeProductGuest);

  const [walmartInput, setWalmartInput] = useState("");
  const [walmart, setWalmart] = useState<ProductData | null>(null);
  const [wLoading, setWLoading] = useState(false);

  const [amazon, setAmazon] = useState<AmazonProduct>({});
  const [amazonUrl, setAmazonUrl] = useState("");

  const walmartOffer = useMemo(() => walmartToOffer(walmart), [walmart]);
  const amazonOffer = useMemo(() => amazonToOffer(amazon), [amazon]);
  const result = useMemo(
    () => compareOffers(walmartOffer, amazonOffer),
    [walmartOffer, amazonOffer],
  );

  async function runWalmart() {
    const v = walmartInput.trim();
    if (!v) return;
    setWLoading(true);
    try {
      const res = await analyze({ data: { input: v } });
      setWalmart(res.product as ProductData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not fetch that Walmart product.";
      toast.error(msg);
    } finally {
      setWLoading(false);
    }
  }

  function applyAmazonUrl() {
    const asin = extractAsin(amazonUrl);
    if (!asin) {
      toast.error("Paste an amazon.com/dp/… URL or a 10-character ASIN.");
      return;
    }
    setAmazon((a) => ({ ...a, asin, product_url: buildAmazonUrl(asin) }));
    toast.success(`ASIN ${asin} attached. Fill in price and rating below.`);
  }

  function updateAmazon<K extends keyof AmazonProduct>(key: K, value: AmazonProduct[K]) {
    setAmazon((a) => ({ ...a, [key]: value }));
  }

  function num(v: string): number | undefined {
    if (v === "") return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  function int(v: string): number | undefined {
    if (v === "") return undefined;
    const n = parseInt(v.replace(/[^\d-]/g, ""), 10);
    return Number.isFinite(n) ? n : undefined;
  }

  const amazonEmpty =
    amazon.price == null && amazon.title == null && amazon.image == null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background/90 px-4 py-3 backdrop-blur md:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <span className="font-bold">NovaNest Scout</span>
        </Link>
        <Button asChild variant="outline" size="sm">
          <Link to="/">Back to scanner</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
            Amazon vs Walmart
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Paste a Walmart product on the left, enter Amazon details on the right, and see who
            wins on price, rating, and review volume.
          </p>
        </div>

        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Amazon data currently limited — free tier / manual mode active. Paste an Amazon URL
            and fill in the fields; auto-fetch is coming.
          </span>
        </div>

        <section className="mb-5 rounded-2xl border bg-card p-4">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Walmart product
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              value={walmartInput}
              onChange={(e) => setWalmartInput(e.target.value)}
              placeholder="Walmart URL, UPC / GTIN, or item ID"
              onKeyDown={(e) => {
                if (e.key === "Enter") runWalmart();
              }}
            />
            <Button onClick={runWalmart} disabled={wLoading || !walmartInput.trim()}>
              <Search className="mr-1 h-4 w-4" />
              {wLoading ? "Fetching…" : "Fetch"}
            </Button>
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">
            Try 6-piece bath towel sets:{" "}
            <a
              className="underline hover:text-foreground"
              href={TOWEL_SEARCH}
              target="_blank"
              rel="noopener noreferrer"
            >
              browse on Walmart
            </a>
            , then paste any product URL.
          </div>
        </section>

        <section className="mb-6 rounded-2xl border bg-card p-4">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Amazon product
          </Label>
          <Tabs defaultValue="manual" className="mt-2">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">Manual entry</TabsTrigger>
              <TabsTrigger value="auto" disabled>
                Auto-fetch (soon)
              </TabsTrigger>
            </TabsList>
            <TabsContent value="manual" className="mt-3 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={amazonUrl}
                  onChange={(e) => setAmazonUrl(e.target.value)}
                  placeholder="Amazon URL or ASIN (optional)"
                />
                <Button type="button" variant="outline" onClick={applyAmazonUrl}>
                  <Wand2 className="mr-1 h-4 w-4" /> Attach ASIN
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title">
                  <Input
                    value={amazon.title ?? ""}
                    onChange={(e) => updateAmazon("title", e.target.value || undefined)}
                    placeholder="Product title"
                  />
                </Field>
                <Field label="Image URL">
                  <Input
                    value={amazon.image ?? ""}
                    onChange={(e) => updateAmazon("image", e.target.value || undefined)}
                    placeholder="https://…"
                  />
                </Field>
                <Field label="Price ($)">
                  <Input
                    inputMode="decimal"
                    value={amazon.price ?? ""}
                    onChange={(e) => updateAmazon("price", num(e.target.value))}
                    placeholder="e.g. 29.99"
                  />
                </Field>
                <Field label="Rating (0–5)">
                  <Input
                    inputMode="decimal"
                    value={amazon.rating ?? ""}
                    onChange={(e) => updateAmazon("rating", num(e.target.value))}
                    placeholder="e.g. 4.5"
                  />
                </Field>
                <Field label="Review count">
                  <Input
                    inputMode="numeric"
                    value={amazon.review_count ?? ""}
                    onChange={(e) => updateAmazon("review_count", int(e.target.value))}
                    placeholder="e.g. 1234"
                  />
                </Field>
                <Field label="ASIN">
                  <Input
                    value={amazon.asin ?? ""}
                    onChange={(e) =>
                      updateAmazon("asin", e.target.value.toUpperCase() || undefined)
                    }
                    placeholder="10-char ASIN"
                  />
                </Field>
              </div>
            </TabsContent>
          </Tabs>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <CompareCard
            offer={walmartOffer}
            loading={wLoading}
            empty={!walmart && !wLoading}
            emptyLabel="Paste a Walmart URL above and hit Fetch."
          />
          <CompareCard
            offer={amazonOffer}
            empty={amazonEmpty}
            emptyLabel="Fill in Amazon price, rating, and reviews above."
          />
        </div>

        <div className="mt-4">
          <CompareSummary result={result} />
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}