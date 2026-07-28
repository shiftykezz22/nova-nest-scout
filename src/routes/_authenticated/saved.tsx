import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
export const Route = createFileRoute("/_authenticated/saved")({
  ssr: false,
  head: () => ({ meta: [
    { title: "Saved — NovaNest Scout" },
    { name: "description", content: "Bookmarked Walmart product scans." },
    { property: "og:title", content: "NovaNest Scout saved" },
    { property: "og:description", content: "Products you saved from scan results." },
  ]}),
  component: () => (<><PageHeader title="Saved products" subtitle="Bookmark scans from a scan detail page to see them here." /><div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">Coming soon.</div></>),
});