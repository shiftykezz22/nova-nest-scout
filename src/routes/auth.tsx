import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingBag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { clearGuest } from "@/lib/guest";

type Search = { mode?: "signin" | "signup" | "reset" };

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [
    { title: "Sign in — NovaNest Scout" },
    { name: "description", content: "Sign in or create an account to save Walmart product scans, suppliers and calculations." },
    { property: "og:title", content: "NovaNest Scout — Sign in" },
    { property: "og:description", content: "Save scans, suppliers, and calculations. Unlimited scans for members." },
  ]}),
  validateSearch: (s: Record<string, unknown>): Search => ({
    mode: (s.mode as Search["mode"]) ?? "signin",
  }),
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const { mode: initial } = Route.useSearch();
  const [mode, setMode] = useState<"signin" | "signup" | "reset">(initial ?? "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        clearGuest();
        router.navigate({ to: "/dashboard", replace: true });
      }
    });
  }, [router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: `${window.location.origin}/dashboard`, data: { display_name: name || email.split("@")[0] } },
        });
        if (error) throw error;
        toast.success("Check your email to confirm your account.");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        clearGuest();
        router.navigate({ to: "/dashboard", replace: true });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth` });
        if (error) throw error;
        toast.success("Password reset email sent.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function googleSignIn() {
    try {
      await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Google sign-in failed");
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-4 py-4 md:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <ShoppingBag className="h-4 w-4" />
          </div>
          <span className="font-bold">NovaNest Scout</span>
        </Link>
      </header>
      <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-8">
        <div className="rounded-2xl border bg-card p-6 shadow-sm">
          <h1 className="text-2xl font-bold">
            {mode === "signup" ? "Create your account" : mode === "reset" ? "Reset password" : "Sign in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signup" ? "Save scans, suppliers, calculations, and history." : mode === "reset" ? "We'll email you a reset link." : "Welcome back to NovaNest Scout."}
          </p>

          {mode !== "reset" && (
            <Button variant="outline" onClick={googleSignIn} className="mt-5 w-full">
              Continue with Google
            </Button>
          )}
          {mode !== "reset" && <div className="my-4 text-center text-xs text-muted-foreground">or</div>}

          <form onSubmit={onSubmit} className="space-y-3">
            {mode === "signup" && (
              <div>
                <Label>Display name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex" className="mt-1" />
              </div>
            )}
            <div>
              <Label>Email</Label>
              <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
            </div>
            {mode !== "reset" && (
              <div>
                <Label>Password</Label>
                <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in"}
            </Button>
          </form>

          <div className="mt-4 flex flex-wrap justify-between text-xs text-muted-foreground">
            {mode !== "signin" && <button onClick={() => setMode("signin")} className="hover:text-primary">I have an account</button>}
            {mode !== "signup" && <button onClick={() => setMode("signup")} className="hover:text-primary">Create account</button>}
            {mode !== "reset" && <button onClick={() => setMode("reset")} className="hover:text-primary">Forgot password?</button>}
          </div>
        </div>
        <div className="mt-4 text-center text-xs text-muted-foreground">
          <Link to="/" className="hover:text-primary">← Back to home</Link>
        </div>
      </div>
    </div>
  );
}