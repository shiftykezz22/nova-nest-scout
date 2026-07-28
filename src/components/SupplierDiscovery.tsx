import { useEffect, useMemo, useState } from "react";
import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SupplierList } from "./SupplierList";
import { Loader2, Search, Plus, MapPin, AlertCircle, Link2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { searchSuppliersPublic, tavilyStatus, searchAndSaveSuppliers, analyzeSupplierUrl } from "@/lib/suppliers.functions";
import { generateSupplierLinks } from "@/lib/supplier-links";
import { toast } from "sonner";

type Props = {
  product: ProductData;
  scanId?: string;
  initialSuppliers?: Supplier[];
  selected: Supplier | null;
  onSelect: (s: Supplier | null) => void;
  onUseCost: (s: Supplier, unitCost: number) => void;
};

type Radius = 10 | 25 | 50;
type Channel = "wholesale" | "overseas" | "local" | "marketplace" | "pasted" | "all";
type Match = "all" | "exact" | "likely" | "category";
type Sort = "match" | "price" | "local";

function dedupeSuppliers(list: Supplier[]): Supplier[] {
  const seen = new Set<string>();
  const out: Supplier[] = [];
  for (const s of list) {
    const domain = (s.supplier_url ? new URL(s.supplier_url).hostname.replace(/^www\./, "") : s.supplier_name).toLowerCase();
    const name = s.supplier_name.trim().toLowerCase();
    const phone = (s.contact_data?.phone || "").replace(/\D/g, "");
    const addr = (s.contact_data?.address || "").toLowerCase().replace(/\s+/g, " ");
    const key = `${domain}|${name}|${phone}|${addr}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export function SupplierDiscovery({ product, scanId, initialSuppliers, selected, onSelect, onUseCost }: Props) {
  const [liveSuppliers, setLiveSuppliers] = useState<Supplier[]>(initialSuppliers ?? []);
  const [pastedSuppliers, setPastedSuppliers] = useState<Supplier[]>([]);
  const [searching, setSearching] = useState(false);
  const [tavConfigured, setTavConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [ran, setRan] = useState(false);
  const [pasteUrl, setPasteUrl] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [channel, setChannel] = useState<Channel>("wholesale");

  const [location, setLocation] = useState("Brooklyn, NY");
  const [radius, setRadius] = useState<Radius>(25);
  const [match, setMatch] = useState<Match>("all");
  const [sort, setSort] = useState<Sort>("match");

  const searchPublic = useServerFn(searchSuppliersPublic);
  const searchSave = useServerFn(searchAndSaveSuppliers);
  const getStatus = useServerFn(tavilyStatus);
  const analyze = useServerFn(analyzeSupplierUrl);

  useEffect(() => { getStatus().then((r) => setTavConfigured(r.configured)).catch(() => setTavConfigured(false)); }, [getStatus]);

  const generatedLinks = useMemo(() => generateSupplierLinks(product, { location, radiusMiles: radius }), [product, location, radius]);

  const allSuppliers = useMemo(() => {
    // Merge: pasted first, then live, then generated. Dedupe by domain+name.
    const seen = new Set<string>();
    const out: Supplier[] = [];
    const push = (s: Supplier) => {
      const host = (s.supplier_url ? (() => { try { return new URL(s.supplier_url!).hostname.replace(/^www\./, ""); } catch { return s.supplier_name; } })() : s.supplier_name).toLowerCase();
      const key = `${host}|${s.channel ?? ""}|${(s.query ?? s.supplier_name).toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(s);
    };
    pastedSuppliers.forEach(push);
    liveSuppliers.forEach(push);
    generatedLinks.forEach(push);
    return out;
  }, [pastedSuppliers, liveSuppliers, generatedLinks]);

  async function runSearch(opts?: { onlineOnly?: boolean; byUpcOnly?: boolean; genericOnly?: boolean; broaden?: boolean }) {
    if (!product.title && !product.brand && !product.upc_gtin) {
      toast.error("Not enough product data to search yet.");
      return;
    }
    setSearching(true); setError(null); setRan(true);
    try {
      const useLocation = opts?.onlineOnly ? undefined : location;
      const payload = {
        title: opts?.genericOnly ? product.category ?? product.title : product.title,
        brand: opts?.byUpcOnly ? undefined : product.brand,
        upc: product.upc_gtin,
        model: opts?.byUpcOnly ? undefined : product.model,
        category: product.category,
        size: product.size,
        walmartPrice: product.price,
        location: useLocation,
        radiusMiles: opts?.broaden ? 50 : radius,
        onlineOnly: opts?.onlineOnly === true,
      };
      const res = scanId
        ? await searchSave({ data: { ...payload, productScanId: scanId } })
        : await searchPublic({ data: payload });
      setTavConfigured(res.configured);
      if (!res.configured) {
        toast.message("Live search not configured — showing generated search links.");
        return;
      }
      const clean = dedupeSuppliers(res.suppliers);
      setLiveSuppliers(clean);
      if (clean.length === 0) toast.message("No live results matched — generated links are still available."); else toast.success(`Found ${clean.length} live suppliers`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed. Try again.");
    } finally {
      setSearching(false);
    }
  }

  async function runAnalyze() {
    const url = pasteUrl.trim();
    if (!/^https?:\/\//i.test(url)) { toast.error("Paste a full https:// URL"); return; }
    setAnalyzing(true);
    try {
      const res = await analyze({ data: {
        url,
        productScanId: scanId,
        title: product.title, brand: product.brand, upc: product.upc_gtin, model: product.model, size: product.size,
      } });
      setPastedSuppliers((cur) => [res.supplier, ...cur]);
      setChannel("pasted");
      setPasteUrl("");
      onSelect(res.supplier);
      if (res.fetched) toast.success(`Analyzed — ${res.supplier.match_kind?.replace(/_/g, " ")}`);
      else toast.message("Fetched limited info — verify the page manually.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not analyze that link");
    } finally { setAnalyzing(false); }
  }

  function addManual(m: Partial<Supplier> & { supplier_name: string }) {
    const s: Supplier = {
      supplier_name: m.supplier_name,
      supplier_url: m.supplier_url,
      unit_cost: m.unit_cost ?? null,
      moq: m.moq ?? null,
      lead_time_days: m.lead_time_days ?? null,
      product_match: "likely",
      match_kind: "unverified_lead",
      verification_status: m.unit_cost ? "verified_public" : "quote_required",
      supplier_type: "unknown",
      region_bucket: "us",
      source: "manual",
      origin: "manual",
      channel: "pasted",
      reasons: ["Entered manually by user."],
      contact_data: { approximate_location: location, is_online: !m.supplier_url ? false : true },
    };
    setPastedSuppliers((cur) => [s, ...cur]);
    onSelect(s);
    setManualOpen(false);
    setChannel("pasted");
  }

  const filtered = allSuppliers.filter((s) => {
    if (channel !== "all") {
      if (channel === "pasted" && s.channel !== "pasted") return false;
      if (channel !== "pasted" && s.channel !== channel) return false;
    }
    if (match !== "all") {
      const mk = s.match_kind ?? (s.product_match === "exact" ? "verified_exact" : s.product_match === "likely" ? "likely" : "category");
      if (match === "exact" && mk !== "verified_exact") return false;
      if (match === "likely" && mk !== "likely") return false;
      if (match === "category" && mk !== "category") return false;
    }
    return true;
  }).sort((a, b) => {
    // Keep generated links after live/pasted rows within a channel.
    const oa = a.origin === "generated_link" ? 1 : 0;
    const ob = b.origin === "generated_link" ? 1 : 0;
    if (oa !== ob) return oa - ob;
    if (sort === "price") return (a.unit_cost ?? Infinity) - (b.unit_cost ?? Infinity);
    if (sort === "local") {
      const la = a.region_bucket && !["us", "international"].includes(a.region_bucket) ? 0 : 1;
      const lb = b.region_bucket && !["us", "international"].includes(b.region_bucket) ? 0 : 1;
      return la - lb;
    }
    return (b.match_confidence ?? 0) - (a.match_confidence ?? 0);
  });

  const counts = useMemo(() => ({
    wholesale: allSuppliers.filter((s) => s.channel === "wholesale").length,
    overseas: allSuppliers.filter((s) => s.channel === "overseas").length,
    local: allSuppliers.filter((s) => s.channel === "local").length,
    marketplace: allSuppliers.filter((s) => s.channel === "marketplace").length,
    pasted: allSuppliers.filter((s) => s.channel === "pasted").length,
    all: allSuppliers.length,
  }), [allSuppliers]);

  const statusText = searching
    ? "Checking for live results…"
    : tavConfigured === false
      ? "Live search unavailable — showing generated links. Add a free Tavily or Serper key later for live results."
      : tavConfigured === null
        ? "Building supplier searches…"
        : ran
          ? `Ready · ${liveSuppliers.length} live · ${generatedLinks.length} generated`
          : `Ready · ${generatedLinks.length} generated links · click Find suppliers for live results`;

  return (
    <section className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Supplier discovery</h2>
          <p className="text-xs text-muted-foreground">{statusText}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setManualOpen((v) => !v)}><Plus className="mr-1 h-4 w-4" /> Add manually</Button>
      </div>

      <div className="mt-4 rounded-xl border bg-background p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <Input placeholder="Paste any supplier or product page URL" value={pasteUrl} onChange={(e) => setPasteUrl(e.target.value)} className="h-9 flex-1 min-w-[220px]" />
          <Button size="sm" onClick={runAnalyze} disabled={analyzing || !pasteUrl.trim()}>
            {analyzing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Analyze link
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">We compare the page against this product's brand, UPC and model and give a match score.</p>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <div className="md:col-span-2">
          <Label className="text-xs text-muted-foreground">Search near</Label>
          <div className="relative mt-1">
            <MapPin className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Brooklyn, NY" />
          </div>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Radius</Label>
          <Select value={String(radius)} onValueChange={(v) => setRadius(parseInt(v, 10) as Radius)}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10 miles</SelectItem>
              <SelectItem value="25">25 miles</SelectItem>
              <SelectItem value="50">50 miles</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end">
          <Button className="w-full" onClick={() => runSearch()} disabled={searching || tavConfigured === false}>
            {searching ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Search className="mr-1 h-4 w-4" />}
            {ran ? "Re-run live search" : "Find live suppliers"}
          </Button>
        </div>
      </div>

      <Tabs value={channel} onValueChange={(v) => setChannel(v as Channel)} className="mt-5">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto">
          <TabsTrigger value="wholesale">Wholesalers <span className="ml-1 text-[10px] opacity-60">{counts.wholesale}</span></TabsTrigger>
          <TabsTrigger value="overseas">Alibaba / Overseas <span className="ml-1 text-[10px] opacity-60">{counts.overseas}</span></TabsTrigger>
          <TabsTrigger value="local">Local / U.S. <span className="ml-1 text-[10px] opacity-60">{counts.local}</span></TabsTrigger>
          <TabsTrigger value="marketplace">Marketplaces <span className="ml-1 text-[10px] opacity-60">{counts.marketplace}</span></TabsTrigger>
          <TabsTrigger value="pasted">Saved / Pasted <span className="ml-1 text-[10px] opacity-60">{counts.pasted}</span></TabsTrigger>
          <TabsTrigger value="all">All <span className="ml-1 text-[10px] opacity-60">{counts.all}</span></TabsTrigger>
        </TabsList>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={match} onValueChange={(v) => setMatch(v as Match)}>
            <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All matches</SelectItem>
              <SelectItem value="exact">Verified exact</SelectItem>
              <SelectItem value="likely">Likely</SelectItem>
              <SelectItem value="category">Category only</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
            <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="match">Best match</SelectItem>
              <SelectItem value="price">Lowest cost</SelectItem>
              <SelectItem value="local">Local first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <TabsContent value={channel} className="mt-4" forceMount>
          {renderBody()}
        </TabsContent>
      </Tabs>

      {manualOpen && <ManualForm onAdd={addManual} onCancel={() => setManualOpen(false)} />}
    </section>
  );

  function renderBody() {
    return (
      <div>
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="flex-1">{error}</div>
            <Button size="sm" variant="outline" onClick={() => runSearch()}>Retry</Button>
          </div>
        )}
        {searching && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
          </div>
        )}
        {!searching && filtered.length === 0 && (
          <div className="rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            {channel === "pasted"
              ? "Paste a supplier URL above or use Add manually to save one here."
              : "No results in this channel yet — click Find live suppliers or try another tab."}
          </div>
        )}
        {!searching && filtered.length > 0 && (
          <SupplierList
            suppliers={filtered}
            walmartPrice={product.price}
            selectedId={selected ? (selected.id ?? `${selected.supplier_name}|${selected.supplier_url ?? ""}`) : null}
            onSelect={onSelect}
            onUseCost={onUseCost}
            onAnalyze={(s) => { if (s.supplier_url) { setPasteUrl(s.supplier_url); setTimeout(() => runAnalyze(), 0); } }}
            product={{ title: product.title, upc_gtin: product.upc_gtin, model: product.model }}
          />
        )}
      </div>
    );
  }
}

function ManualForm({ onAdd, onCancel }: { onAdd: (s: Partial<Supplier> & { supplier_name: string }) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [price, setPrice] = useState("");
  const [moq, setMoq] = useState("");
  const [lead, setLead] = useState("");
  return (
    <div className="mt-4 grid gap-2 rounded-xl border bg-background p-3 sm:grid-cols-2">
      <Input placeholder="Supplier name" value={name} onChange={(e) => setName(e.target.value)} />
      <Input placeholder="Website (optional)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <Input placeholder="Unit price (USD)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      <Input placeholder="MOQ" type="number" value={moq} onChange={(e) => setMoq(e.target.value)} />
      <Input placeholder="Lead time (days)" type="number" value={lead} onChange={(e) => setLead(e.target.value)} />
      <div className="flex gap-2 sm:col-span-2">
        <Button disabled={!name} onClick={() => onAdd({
          supplier_name: name,
          supplier_url: url || undefined,
          unit_cost: price ? parseFloat(price) : undefined,
          moq: moq ? parseInt(moq, 10) : undefined,
          lead_time_days: lead ? parseInt(lead, 10) : undefined,
        })}>Add supplier</Button>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}