import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const FIELDS: Array<[string, string]> = [
  ["referral_fee_percent", "Referral fee %"],
  ["fulfillment_fee", "Fulfillment fee ($)"],
  ["storage_cost", "Storage cost ($)"],
  ["inbound_shipping_per_unit", "Inbound shipping ($/unit)"],
  ["prep_cost_per_unit", "Prep cost ($/unit)"],
  ["duties_per_unit", "Duties ($/unit)"],
  ["advertising_percent", "Advertising %"],
  ["return_allowance_percent", "Return allowance %"],
  ["desired_profit", "Desired profit ($)"],
];

export const Route = createFileRoute("/_authenticated/settings")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Settings — NovaNest Scout" },
    { name: "description", content: "Configure marketplace fees, prep, and profit defaults." },
    { property: "og:title", content: "NovaNest Scout settings" },
    { property: "og:description", content: "Adjust default calculation assumptions." },
  ]}),
  component: Settings,
});

function Settings() {
  const [state, setState] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    supabase.from("calculation_settings").select("*").maybeSingle().then(({ data }) => {
      if (data) setState(Object.fromEntries(FIELDS.map(([k]) => [k, (data as never as Record<string, number>)[k]])));
      else setState(Object.fromEntries(FIELDS.map(([k]) => [k, 0])));
    });
  }, []);
  async function save() {
    if (!state) return;
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("calculation_settings").upsert({ user_id: u.user.id, ...state } as never, { onConflict: "user_id" });
    if (error) toast.error(error.message); else toast.success("Settings saved");
  }
  if (!state) return <div className="text-sm text-muted-foreground">Loading…</div>;
  return (
    <>
      <PageHeader title="Calculation settings" subtitle="These defaults apply to every new scan." />
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(([k, l]) => (
          <div key={k}>
            <Label className="text-xs text-muted-foreground">{l}</Label>
            <Input type="number" value={state[k] ?? 0} onChange={(e) => setState((s) => ({ ...(s ?? {}), [k]: parseFloat(e.target.value) || 0 }))} className="mt-1" />
          </div>
        ))}
      </div>
      <Button onClick={save} className="mt-4">Save settings</Button>
    </>
  );
}