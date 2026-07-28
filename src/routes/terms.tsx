import { createFileRoute, Link } from "@tanstack/react-router";
export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [
    { title: "Terms — NovaNest Scout" },
    { name: "description", content: "Terms of use for NovaNest Scout." },
    { property: "og:title", content: "NovaNest Scout terms" },
    { property: "og:description", content: "Terms of use and disclaimers." },
  ]}),
  component: () => (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-primary">← Back home</Link>
      <h1 className="mt-4 text-3xl font-bold">Terms</h1>
      <p className="mt-4 text-sm text-muted-foreground">NovaNest Scout is a research tool. All estimates, verdicts, supplier scores, and profit projections are informational only. Verify pricing, freight, authorization, and marketplace policies directly before purchasing inventory.</p>
    </div>
  ),
});