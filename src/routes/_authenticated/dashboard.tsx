import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { identifyInput } from "@/lib/walmart";
import { analyzeProduct, searchWalmartMatches } from "@/lib/scan.functions";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/AppShell";
import { SearchResults, type Candidate } from "@/components/SearchResults";

export const Route = createFileRoute("/_authenticated/dashboard")({
  ssr: false,
  head: () => ({ meta: [
    { title: "New scan — NovaNest Scout" },
    { name: "description", content: "Analyze a Walmart product URL and start supplier discovery." },
    { property: "og:title", content: "NovaNest Scout dashboard" },
    { property: "og:description", content: "Paste a Walmart URL to start a new analysis." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary_large_image" },
  ]}),
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchWarn, setSearchWarn] = useState<string | null>(null);
  const analyze = useServerFn(analyzeProduct);
  const search = useServerFn(searchWalmartMatches);

  async function runAnalyze(input: string) {
    setLoading(true);
    try {
      const res = await analyze({ data: { input } });
      router.navigate({ to: "/scans/$id", params: { id: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally { setLoading(false); }
  }

  async function onScan() {
    if (loading) return;
    const id = identifyInput(url);
    if (!id.ok) { toast.error(id.error); return; }
    if (id.kind === "url" || id.kind === "item_id") {
      setCandidates(null);
      await runAnalyze(url);
      return;
    }
    setLoading(true);
    setSearchWarn(null);
    try {
      const r = await search({ data: { input: url } });
      if (r.kind === "direct") { await runAnalyze(r.url ?? url); return; }
      setCandidates(r.candidates);
      if (r.warning) setSearchWarn(r.warning);
      if (!r.candidates.length && !r.warning) setSearchWarn("No matches found. Try a Walmart URL or item ID.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally { setLoading(false); }
  }
  return (
    <>
      <PageHeader title="New Walmart product scan" subtitle="Paste a Walmart URL, item ID, UPC, or keyword. We'll retrieve public data and start supplier discovery." />
      <div className="rounded-2xl border bg-card p-4 md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Walmart URL · UPC · item ID · brand + model" className="h-12 rounded-xl text-base" />
          <Button onClick={onScan} disabled={loading || !url} size="lg" className="h-12 rounded-xl">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Find product
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">URLs and item IDs are analyzed directly. UPCs and keywords return up to 5 candidate products for you to confirm.</p>
      </div>
      {candidates !== null && (
        <div className="mt-4">
          {searchWarn && <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">{searchWarn}</div>}
          <SearchResults candidates={candidates} onSelect={(c) => c.url && runAnalyze(c.url)} loading={loading} />
        </div>
      )}
    </>
  );
}