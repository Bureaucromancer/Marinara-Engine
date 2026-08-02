// ──────────────────────────────────────────────
// Modal: Import Scenario (JSON)
//
// Two source shapes, sniffed per file:
//   - a native `marinara_scenario` envelope  -> /import/marinara
//   - a bare compatible scenario object      -> /import/compatible-scenario
//
// The compatible shape has no envelope and no `type` discriminator, so it can
// only be recognised structurally; isCompatibleScenarioShape is the same check
// the server uses, imported from shared so the two cannot disagree.
// ──────────────────────────────────────────────
import { useState, useRef } from "react";
import { Modal } from "../ui/Modal";
import { Download, FileJson, CheckCircle, XCircle, Loader2, Link2Off } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { isCompatibleScenarioShape } from "@marinara-engine/shared";
import { api } from "../../lib/api-client";
import { useTranslation as useUiTranslation } from "react-i18next";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface ImportResultRow {
  filename: string;
  success: boolean;
  message: string;
  droppedLinks?: Array<{ kind: string; ref: string }>;
}

export function ImportScenarioModal({ open, onClose }: Props) {
  const { t: localizeUi } = useUiTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [results, setResults] = useState<ImportResultRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const qc = useQueryClient();

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setStatus("loading");
    setResults([]);

    const nextResults: ImportResultRow[] = [];
    for (const file of files) {
      try {
        const json = JSON.parse(await file.text()) as Record<string, unknown>;
        const timestampOverrides = { createdAt: file.lastModified, updatedAt: file.lastModified };

        const isNativeScenario = json.type === "marinara_scenario" && json.version === 1;
        const isCompatible = !isNativeScenario && isCompatibleScenarioShape(json);

        if (!isNativeScenario && !isCompatible) {
          nextResults.push({
            filename: file.name,
            success: false,
            message: "Not a scenario file",
          });
          continue;
        }

        const endpoint = isNativeScenario ? "/import/marinara" : "/import/compatible-scenario";
        const payload = isNativeScenario
          ? { ...json, timestampOverrides }
          : { ...json, __filename: file.name.replace(/\.json$/i, ""), timestampOverrides };

        const data = await api.post<{
          success: boolean;
          error?: string;
          droppedLinks?: Array<{ kind: string; ref: string }>;
        }>(endpoint, payload);

        nextResults.push({
          filename: file.name,
          success: data.success,
          message: data.success
            ? isNativeScenario
              ? "Imported scenario"
              : "Imported scenario (compatible format)"
            : (data.error ?? "Import failed"),
          droppedLinks: data.droppedLinks,
        });
      } catch (error) {
        nextResults.push({
          filename: file.name,
          success: false,
          message: error instanceof Error ? error.message : "Failed to parse file",
        });
      }
    }

    setResults(nextResults);
    setStatus("done");
    if (nextResults.some((result) => result.success)) {
      qc.invalidateQueries({ queryKey: ["scenarios"] });
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragOver(false);
    void handleFiles(Array.from(event.dataTransfer.files));
  };

  const reset = () => {
    setStatus("idle");
    setResults([]);
  };

  const close = () => {
    reset();
    onClose();
  };

  return (
    <Modal open={open} onClose={close} title={localizeUi("ui.modals.importscenariomodal.importScenario")}>
      <div className="flex flex-col gap-4">
        <div
          onDrop={handleDrop}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
            dragOver
              ? "border-[var(--primary)] bg-[var(--primary)]/10"
              : "border-[var(--border)] hover:border-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50"
          }`}
        >
          <Download size="2rem" className={dragOver ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"} />
          <p className="text-sm font-medium">{localizeUi("ui.modals.importscenariomodal.dropOneOrMoreScenarioFilesHereOrClick")}</p>
          <span className="flex items-center gap-1 rounded-full bg-[var(--secondary)] px-2.5 py-1 text-xs text-[var(--muted-foreground)]">
            <FileJson size="0.75rem" /> {localizeUi("ui.agents.tooleditor.json")}</span>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".json"
          multiple
          className="hidden"
          onChange={(event) => {
            void handleFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />

        {status === "loading" && (
          <div className="flex items-center gap-2 rounded-lg bg-[var(--secondary)] p-3 text-xs">
            <Loader2 size="0.875rem" className="animate-spin text-[var(--primary)]" /> {localizeUi("ui.panels.backgroundpicker.importing")}</div>
        )}

        {status === "done" && results.length > 0 && (
          <div className="flex flex-col gap-2">
            <div
              className={`flex items-center gap-2 rounded-lg p-3 text-xs ${
                results.some((result) => result.success)
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-[var(--destructive)]/10 text-[var(--destructive)]"
              }`}
            >
              {results.some((result) => result.success) ? (
                <CheckCircle size="0.875rem" />
              ) : (
                <XCircle size="0.875rem" />
              )}
              {results.filter((result) => result.success).length} {localizeUi("ui.modals.importcharactermodal.succeeded")}{" "}
              {results.filter((result) => !result.success).length} {localizeUi("ui.modals.importcharactermodal.failed")}</div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-[var(--border)]">
              {results.map((result) => (
                <div
                  key={`${result.filename}-${result.message}`}
                  className="flex items-start gap-2 border-b border-[var(--border)] px-3 py-2 text-xs last:border-b-0"
                >
                  {result.success ? (
                    <CheckCircle size="0.8125rem" className="mt-0.5 shrink-0 text-emerald-400" />
                  ) : (
                    <XCircle size="0.8125rem" className="mt-0.5 shrink-0 text-[var(--destructive)]" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">{result.filename}</div>
                    <div className="text-[var(--muted-foreground)]">{result.message}</div>
                    {result.droppedLinks && result.droppedLinks.length > 0 && (
                      <div className="mt-1 flex items-start gap-1 text-[0.6875rem] text-amber-500">
                        <Link2Off size="0.6875rem" className="mt-0.5 shrink-0" />
                        <span>
                          {result.droppedLinks.length} {localizeUi("ui.modals.importscenariomodal.linkSCouldNotBeFoundHereAndWere")}{" "}
                          {result.droppedLinks.map((link) => link.ref).join(", ")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-[var(--border)] pt-3">
          <button
            onClick={close}
            className="rounded-lg px-4 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >{localizeUi("capabilities.actions.close")}</button>
        </div>
      </div>
    </Modal>
  );
}
