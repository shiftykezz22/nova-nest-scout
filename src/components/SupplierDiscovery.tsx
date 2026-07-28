import { useEffect, useState } from "react";
import type { ProductData } from "@/lib/walmart";
import type { Supplier } from "@/lib/suppliers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SupplierList } from "./SupplierList";
import { Loader2, Search, Plus, MapPin, AlertCircle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { searchSuppliersPublic, tavilyStatus, searchAndSaveSuppliers } from "@/lib/suppliers.functions";
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
type Kind = "all" | "local" | "online" | "manufacturer" | "distributor" | "wholesaler";
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
  const [suppliers, setSuppliers] = useState<Supplier[]>(initialSuppliers ?? []);
  const [searching, setSearching] = useState(false);
  const [tavConfigured, setTavConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [ran, setRan] = useState(false);

  const [location, setLocation] = useState("Brooklyn, NY");
  const [radius, setRadius] = useState<Radius>(25);
  const [kind, setKind] = useState<Kind>("all");
  const [match, setMatch] = useState<Match>("all");
  const [sort, setSort] = useState<Sort>("match");

  const searchPublic = useServerFn(searchSuppliersPublic);
  const searchSave = useServerFn(searchAndSaveSuppliers);
  const getStatus = useServerFn(tavilyStatus);

  useEffect(() => { getStatus().then((r) => setTavConfigured(r.configured)).catch(() => setTavConfigured(false)); }, [getStatus]);

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
      if (!res.configured) { setError("Supplier search is not configured. You can still add a supplier manually below."); return; }
      const clean = dedupeSuppliers(res.suppliers);
      setSuppliers(clean);
      if (clean.length === 0) toast.message("No suppliers matched. Try broadening the search."); else toast.success(`Found ${clean.length} suppliers`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed. Try again.");
    } finally {
      setSearching(false);
    }
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
      reasons: ["Entered manually by user."],
      contact_data: { approximate_location: location, is_online: !m.supplier_url ? false : true },
    };
    setSuppliers((cur) => [s, ...cur]);
    onSelect(s);
    setManualOpen(false);
  }

  const filtered = suppliers.filter((s) => {
    if (match !== "all") {
      const mk = s.match_kind ?? (s.product_match === "exact" ? "verified_exact" : s.product_match === "likely" ? "likely" : "category");
      if (match === "exact" && mk !== "verified_exact") return false;
      if (match === "likely" && mk !== "likely") return false;
      if (match === "category" && mk !== "category") return false;
    }
    if (kind === "local") return !!s.region_bucket && !["us", "international"].includes(s.region_bucket);
    if (kind === "online") return s.contact_data?.is_online === true || s.region_bucket === "us" || s.region_bucket === "international";
    if (kind === "manufacturer") return s.supplier_type === "manufacturer" || s.supplier_type === "private_label";
    if (kind === "distributor") return s.supplier_type === "distributor" || s.supplier_type === "authorized_distributor";
    if (kind === "wholesaler") return s.supplier_type === "wholesaler";
    return true;
  }).sort((a, b) => {
    if (sort === "price") return (a.unit_cost ?? Infinity) - (b.unit_cost ?? Infinity);
    if (sort === "local") {
      const la = a.region_bucket && !["us", "international"].includes(a.region_bucket) ? 0 : 1;
      const lb = b.region_bucket && !["us", "international"].includes(b.region_bucket) ? 0 : 1;
      return la - lb;
    }
    return (b.match_confidence ?? 0) - (a.match_confidence ?? 0);
  });

  const chip = (val: Kind, label: string) => (
    <button key={val} onClick={() => setKind(val)} className={`rounded-full border px-3 py-1 text-xs ${kind === val ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>
  );

  return (
    <section className="rounded-2xl border bg-card p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Supplier discovery</h2>
          <p className="text-xs text-muted-foreground">
            {tavConfigured === false && "Supplier search is not configured. Add suppliers manually."}
            {tavConfigured === true && "Uses the product identity you already scanned. Live search — no fabricated results."}
            {tavConfigured === null && "Checking supplier search connection…"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setManualOpen((v) => !v)}><Plus className="mr-1 h-4 w-4" /> Add manually</Button>
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
            {ran ? "Re-run search" : "Find suppliers"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {chip("all", "All")}
        {chip("local", "Local")}
        {chip("online", "Online")}
        {chip("manufacturer", "Manufacturers")}
        {chip("distributor", "Distributors")}
        {chip("wholesaler", "Wholesalers")}
        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
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
      </div>

      {manualOpen && <ManualForm onAdd={addManual} onCancel={() => setManualOpen(false)} />}

      <div className="mt-4">
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
        {!searching && filtered.length === 0 && ran && (
          <EmptyState
            hasUpc={!!product.upc_gtin}
            onBroaden={() => { setRadius(50); runSearch({ broaden: true }); }}
            onOnline={() => runSearch({ onlineOnly: true })}
            onByUpc={() => runSearch({ byUpcOnly: true })}
            onGeneric={() => runSearch({ genericOnly: true })}
            onManual={() => setManualOpen(true)}
          />
        )}
        {!searching && filtered.length === 0 && !ran && (
          <div className="rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            Ready to search using this product's identity. Adjust location or filters and click Find suppliers.
          </div>
        )}
        {!searching && filtered.length > 0 && (
          <SupplierList
            suppliers={filtered}
            walmartPrice={product.price}
            selectedId={selected ? (selected.id ?? `${selected.supplier_name}|${selected.supplier_url ?? ""}`) : null}
            onSelect={onSelect}
            onUseCost={onUseCost}
            product={{ title: product.title, upc_gtin: product.upc_gtin, model: product.model }}
          />
        )}
      </div>
    </section>
  );
}

function EmptyState(props: { hasUpc: boolean; onBroaden: () => void; onOnline: () => void; onByUpc: () => void; onGeneric: () => void; onManual: () => void }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-5 text-sm">
      <div className="font-semibold">No matching suppliers yet</div>
      <div className="mt-1 text-xs text-muted-foreground">Try one of these next steps:</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={props.onBroaden}>Broaden radius to 50 mi</Button>
        <Button size="sm" variant="outline" onClick={props.onOnline}>Search online suppliers</Button>
        {props.hasUpc && <Button size="sm" variant="outline" onClick={props.onByUpc}>Search by UPC only</Button>}
        <Button size="sm" variant="outline" onClick={props.onGeneric}>Search by generic name</Button>
        <Button size="sm" onClick={props.onManual}>Add supplier manually</Button>
      </div>
    </div>
  );
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