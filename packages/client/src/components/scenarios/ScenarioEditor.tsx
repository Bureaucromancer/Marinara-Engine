// ──────────────────────────────────────────────
// Editor: Scenario
// ──────────────────────────────────────────────
import { useUIStore } from "../../stores/ui.store";
import { useScenario } from "../../hooks/use-scenarios";

export function ScenarioEditor() {
  const scenarioId = useUIStore((s) => s.scenarioDetailId);
  const { data: scenario, isLoading } = useScenario(scenarioId);

  if (isLoading || !scenario) return <div className="shimmer h-8 w-48 rounded-xl" />;

  return (
    <div className="mari-editor-body">
      <div className="mari-editor-content">
        <h1 className="mari-editor-title">{scenario.name}</h1>
      </div>
    </div>
  );
}
