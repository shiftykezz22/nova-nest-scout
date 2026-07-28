import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { formatDistanceToNow } from "date-fns";

type Scan = { id: string; input_url: string; title: string | null; brand: string | null; analysis_status: string; created_at: string };

export const Route = createFileRoute("/_authenticated/scans")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Scan history — NovaNest Scout" },
    { name: "description", content: "Walmart product scans you've analyzed." },
    { property: "og:title", content: "NovaNest Scout history" },
    { property: "og:description", content: "Review or reanalyze previous scans." },
  ]}),
  component: List,
});

function List() {
  const [scans, setScans] = useState<Scan[] | null>(null);
  useEffect(() => {
    supabase.from("product_scans").select("id, input_url, title, brand, analysis_status, created_at").order("created_at", { ascending: false })
      .then(({ data }) => setScans((data as Scan[]) ?? []));
  }, []);
  return (
    <>
      <PageHeader title="Scan history" />
      {scans === null ? <div className="text-sm text-muted-foreground">Loading…</div> :
        scans.length === 0 ? <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">No scans yet.</div> :
        <ul className="space-y-2">
          {scans.map((s) => (
            <li key={s.id}>
              <Link to="/scans/$id" params={{ id: s.id }} className="block rounded-xl border bg-card p-4 hover:border-primary/50">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{s.title || s.input_url}</div>
                    <div className="text-xs text-muted-foreground">{s.brand || "Unknown"} · {s.analysis_status}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(s.created_at), { addSuffix: true })}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>}
    </>
  );
}