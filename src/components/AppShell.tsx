import { Link, useRouter } from "@tanstack/react-router";
import { ScanLine, History, Bookmark, Settings, LogOut, BookOpen, ShoppingBag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const NAV = [
  { to: "/dashboard", label: "New Scan", icon: ScanLine },
  { to: "/scans", label: "History", icon: History },
  { to: "/saved", label: "Saved", icon: Bookmark },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/glossary", label: "Glossary", icon: BookOpen },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const qc = useQueryClient();
  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    toast.success("Signed out");
    router.navigate({ to: "/auth", replace: true });
  }
  return (
    <div className="min-h-screen bg-background">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{ backgroundImage: "radial-gradient(circle at 20% 10%, oklch(0.6 0.22 27) 0, transparent 40%), radial-gradient(circle at 90% 80%, oklch(0.6 0.22 27) 0, transparent 40%)" }}
        aria-hidden
      />
      <div className="relative flex min-h-screen">
        <aside className="hidden md:flex md:w-60 md:flex-col md:border-r md:bg-sidebar">
          <div className="flex h-16 items-center gap-2 px-5 border-b">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div className="font-bold text-foreground">NovaNest Scout</div>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <Link key={n.to} to={n.to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-accent-foreground data-[status=active]:font-semibold">
                  <Icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <button onClick={signOut} className="m-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground hover:bg-muted">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </aside>

        <main className="flex-1 min-w-0 pb-20 md:pb-6">
          <header className="md:hidden sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/90 px-4 backdrop-blur">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div className="font-bold">NovaNest Scout</div>
            <button onClick={signOut} className="ml-auto text-xs text-muted-foreground hover:text-primary">Sign out</button>
          </header>
          <div className="px-4 py-5 md:px-8 md:py-8 max-w-6xl mx-auto">{children}</div>
        </main>

        <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t bg-background">
          <div className="grid grid-cols-5">
            {[
              { to: "/dashboard", label: "Scan", icon: ScanLine },
              { to: "/scans", label: "History", icon: History },
              { to: "/saved", label: "Saved", icon: Bookmark },
              { to: "/settings", label: "Settings", icon: Settings },
              { to: "/glossary", label: "Help", icon: BookOpen },
            ].map((n) => {
              const Icon = n.icon;
              return (
                <Link key={n.to} to={n.to} className="flex flex-col items-center gap-0.5 px-2 py-2 text-[11px] text-muted-foreground data-[status=active]:text-primary">
                  <Icon className="h-5 w-5" />
                  {n.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-bold text-foreground sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </div>
  );
}