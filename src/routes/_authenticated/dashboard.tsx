import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { identifyInput } from "@/lib/walmart";
import { analyzeProduct } from "@/lib/scan.functions";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [
    { title: "New scan — NovaNest Scout" },
    { name: "description", content: "Analyze a Walmart product URL and start supplier discovery." },
    { property: "og:title", content: "NovaNest Scout dashboard" },
    { property: "og:description", content: "Paste a Walmart URL to start a new analysis." },
  ]}),
  component: Dashboard,
});

function Dashboard() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const analyze = useServerFn(analyzeProduct);
  async function onScan() {
    if (loading) return;
    const id = identifyInput(url);
    if (!id.ok) { toast.error(id.error); return; }
    setLoading(true);
    try {
      const res = await analyze({ data: { input: url } });
      router.navigate({ to: "/scans/$id", params: { id: res.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Analysis failed");
    } finally { setLoading(false); }
  }
  return (
    <>
      <PageHeader title="New Walmart product scan" subtitle="Paste any Walmart product URL. We'll retrieve public data and start supplier discovery." />
      <div className="rounded-2xl border bg-card p-4 md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Walmart URL, UPC / GTIN, or item ID" className="h-12 rounded-xl text-base" />
          <Button onClick={onScan} disabled={loading || !url} size="lg" className="h-12 rounded-xl">
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />} Analyze
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Accepts a Walmart product URL, a UPC / GTIN (12-14 digits), or a Walmart item ID (5-11 digits). Tracking parameters are stripped automatically.</p>
      </div>
    </>
  );
}