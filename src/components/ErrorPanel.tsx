import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ErrorPanel({ title, message, backTo = "/dashboard", backLabel = "Return to scanner" }: {
  title: string; message: string; backTo?: string; backLabel?: string;
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-base font-semibold">{title}</div>
          <p className="mt-1 text-sm">{message}</p>
          <div className="mt-4">
            <Button asChild size="sm" variant="outline"><Link to={backTo as never}>{backLabel}</Link></Button>
          </div>
        </div>
      </div>
    </div>
  );
}