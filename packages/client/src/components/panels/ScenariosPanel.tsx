// ──────────────────────────────────────────────
// Panel: Scenarios
// ──────────────────────────────────────────────
import { Clapperboard } from "lucide-react";

export function ScenariosPanel() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="mari-panel-gradient-surface mari-panel-gradient--scenarios flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg">
        <Clapperboard size="1.25rem" />
      </div>
      <p className="text-sm font-medium">Scenarios</p>
    </div>
  );
}
