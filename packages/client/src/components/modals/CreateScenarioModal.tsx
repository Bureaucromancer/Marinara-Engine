// ──────────────────────────────────────────────
// Modal: Create Scenario
// ──────────────────────────────────────────────
import { useState } from "react";
import { Clapperboard, Loader2 } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useCreateScenario } from "../../hooks/use-scenarios";
import { useUIStore } from "../../stores/ui.store";
import { useTranslation as useUiTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

export function CreateScenarioModal({ open, onClose }: Props) {
  const { t: localizeUi } = useUiTranslation();
  const [form, setForm] = useState({ name: "", description: "" });
  const createScenario = useCreateScenario();
  const openScenarioDetail = useUIStore((s) => s.openScenarioDetail);

  const submit = async () => {
    const name = form.name.trim();
    if (!name) return;
    const created = await createScenario.mutateAsync({ name, description: form.description, source: "manual" });
    setForm({ name: "", description: "" });
    onClose();
    openScenarioDetail(created.id);
  };

  return (
    <Modal open={open} onClose={onClose} title={localizeUi("ui.modals.createscenariomodal.newScenario")}>
      <div className="flex flex-col gap-4">
        <div className="mari-panel-gradient-surface mari-panel-gradient--scenarios flex h-10 w-10 items-center justify-center rounded-xl">
          <Clapperboard size="1rem" />
        </div>
        <p className="text-xs leading-relaxed text-[var(--muted-foreground)]">{localizeUi("ui.modals.createscenariomodal.aScenarioIsAReusableSettingCastAndOpening")}</p>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">{localizeUi("settings.customGenerationParameters.name")}</span>
          <input
            autoFocus
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder={localizeUi("ui.modals.createscenariomodal.theDrownedCathedral")}
            className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium">{localizeUi("chat.settings.inlineEditor.fields.description")}</span>
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={2}
            placeholder={localizeUi("ui.modals.createscenariomodal.aShortPreviewShownOnLibraryCards")}
            className="rounded-lg bg-[var(--secondary)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--primary)]"
          />
        </label>

        {createScenario.isError && (
          <p className="rounded-lg bg-[var(--destructive)]/10 px-3 py-2 text-xs text-[var(--destructive)]">
            {createScenario.error instanceof Error ? createScenario.error.message :localizeUi("ui.modals.createscenariomodal.failedToCreateScenario")}
          </p>
        )}

        <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >{localizeUi("chat.delete.dialog.cancel")}</button>
          <button
            onClick={() => void submit()}
            disabled={!form.name.trim() || createScenario.isPending}
            className="mari-panel-gradient-button mari-panel-gradient--scenarios flex items-center gap-1.5 px-4 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {createScenario.isPending && <Loader2 size="0.75rem" className="animate-spin" />}{localizeUi("ui.modals.createcharactermodal.create")}</button>
        </div>
      </div>
    </Modal>
  );
}
