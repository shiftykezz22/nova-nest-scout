import { createFileRoute, Link } from "@tanstack/react-router";
export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [
    { title: "Privacy — NovaNest Scout" },
    { name: "description", content: "How NovaNest Scout handles your data." },
    { property: "og:title", content: "NovaNest Scout privacy" },
    { property: "og:description", content: "Data handling and third-party services." },
  ]}),
  component: () => (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Link to="/" className="text-sm text-muted-foreground hover:text-primary">← Back home</Link>
      <h1 className="mt-4 text-3xl font-bold">Privacy</h1>
      <p className="mt-4 text-sm text-muted-foreground">NovaNest Scout stores only the scans and settings you create. Public product data comes from walmart.com. Supplier candidates come from a server-side web-search integration; no third-party API key is ever sent to your browser.</p>
    </div>
  ),
});