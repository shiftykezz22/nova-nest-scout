import { createFileRoute, Link } from "@tanstack/react-router";
const TERMS: Array<[string, string]> = [
  ["Landed cost", "The unit cost after shipping, duties, prep, and inbound freight."],
  ["Referral fee", "Marketplace commission taken out of each sale, usually a percent of price."],
  ["MOQ", "Minimum Order Quantity — the smallest quantity a supplier will sell."],
  ["Case pack", "How many units come in one physical case from the supplier."],
  ["ROI", "Return on investment — profit divided by landed cost."],
  ["Verified Public Information", "The supplier's own site clearly shows this data."],
  ["Quote Required", "Supplier keeps pricing private — you must request a quote."],
];
export const Route = createFileRoute("/glossary")({
  head: () => ({ meta: [
    { title: "Glossary — NovaNest Scout" },
    { name: "description", content: "Plain-English definitions of the commerce terms used in NovaNest Scout." },
    { property: "og:title", content: "NovaNest Scout glossary" },
    { property: "og:description", content: "Commerce and sourcing terminology, defined simply." },
  ]}),
  component: () => (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-primary">← Back home</Link>
      <h1 className="mt-4 text-3xl font-bold">Glossary</h1>
      <dl className="mt-6 space-y-4">
        {TERMS.map(([t, d]) => (
          <div key={t} className="rounded-xl border bg-card p-4">
            <dt className="font-semibold">{t}</dt>
            <dd className="mt-1 text-sm text-muted-foreground">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  ),
});