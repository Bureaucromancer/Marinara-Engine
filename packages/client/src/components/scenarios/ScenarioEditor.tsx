// ──────────────────────────────────────────────
// Editor: Scenario
//
// Follows the LorebookEditor conventions: no props (the detail id comes from
// the store), local form mirrors hydrated once per scenario, an explicit Save
// button rather than debounced writes, and an unsaved-changes gate on close.
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Clapperboard,
  Download,
  Loader2,
  MessageSquare,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useUIStore } from "../../stores/ui.store";
import {
  useDeleteScenario,
  useScenario,
  useUpdateScenario,
} from "../../hooks/use-scenarios";
import { useLorebooks } from "../../hooks/use-lorebooks";
import type { GeneratedFieldProvenance, ScenarioNpc, ScenarioSetting } from "@marinara-engine/shared";
import { ExpandableTextarea } from "../lorebooks/LorebookFormFields";
import { EditorTabRail, type EditorTabItem } from "../ui/EditorTabRail";
import { ExportFormatDialog, type ExportFormatChoice } from "../ui/ExportFormatDialog";
import { HelpTooltip } from "../ui/HelpTooltip";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { api } from "../../lib/api-client";
import { cn } from "../../lib/utils";

const TABS = [
  { id: "overview", label: "Overview", icon: Settings2 },
  { id: "setting", label: "Setting", icon: Clapperboard },
  { id: "cast", label: "Cast", icon: Users },
  { id: "opening", label: "Opening", icon: MessageSquare },
  { id: "links", label: "Lorebooks", icon: BookOpen },
] as const satisfies readonly EditorTabItem<string>[];

type TabId = (typeof TABS)[number]["id"];

const EMPTY_SETTING: ScenarioSetting = {
  name: "",
  description: "",
  keyLocations: [],
  atmosphere: "",
  themes: [],
  potentialConflicts: [],
};

function blankNpc(): ScenarioNpc {
  return {
    id: `new-${Math.random().toString(36).slice(2, 10)}`,
    name: "",
    // Upstream's editor defaults, kept so a hand-added cast member reads the
    // same way as an imported one.
    role: "Supporting Character",
    description: "",
    relationship: "Neutral",
    traits: [],
    characterId: null,
  };
}

/** Comma-separated chips, the same shape the lorebook editor uses for tags. */
function ChipListField({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const parts = draft
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    onChange(Array.from(new Set([...values, ...parts])));
    setDraft("");
  };

  return (
    <div className="mari-editor-panel">
      <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">{label}</label>
      <div className="mb-2 flex flex-wrap gap-1">
        {values.map((value) => (
          <span key={value} className="mari-editor-chip mari-editor-chip--accent">
            {value}
            <button onClick={() => onChange(values.filter((item) => item !== value))} aria-label="Remove">
              <X size="0.625rem" />
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        placeholder={placeholder}
        className="mari-editor-field w-full px-2 py-1.5 text-xs"
      />
    </div>
  );
}

export function ScenarioEditor() {
  const scenarioId = useUIStore((s) => s.scenarioDetailId);
  const closeDetail = useUIStore((s) => s.closeScenarioDetail);
  const setEditorDirty = useUIStore((s) => s.setEditorDirty);

  const { data: scenario, isLoading, isError } = useScenario(scenarioId);
  const { data: lorebooks = [] } = useLorebooks();
  const updateScenario = useUpdateScenario();
  const deleteScenario = useDeleteScenario();

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const loadedScenarioIdRef = useRef<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState("");
  const [contentRating, setContentRating] = useState<"" | "sfw" | "nsfw">("");
  const [tags, setTags] = useState<string[]>([]);
  const [favorite, setFavorite] = useState(false);
  const [setting, setSetting] = useState<ScenarioSetting>(EMPTY_SETTING);
  const [hasSetting, setHasSetting] = useState(false);
  const [protagonistName, setProtagonistName] = useState("");
  const [protagonistDescription, setProtagonistDescription] = useState("");
  const [protagonistBackstory, setProtagonistBackstory] = useState("");
  const [protagonistMotivation, setProtagonistMotivation] = useState("");
  const [protagonistTraits, setProtagonistTraits] = useState<string[]>([]);
  const [protagonistAppearance, setProtagonistAppearance] = useState("");
  const [hasProtagonist, setHasProtagonist] = useState(false);
  const [npcs, setNpcs] = useState<ScenarioNpc[]>([]);
  const [firstMessage, setFirstMessage] = useState("");
  const [alternateGreetings, setAlternateGreetings] = useState<string[]>([]);
  const [lorebookIds, setLorebookIds] = useState<string[]>([]);

  /**
   * AI provenance is held here and never bound to a form control.
   *
   * Nothing in this PR writes it, but an imported scenario can arrive carrying
   * a map written on someone else's install. A save that serialised only the
   * fields below would silently drop it, and the loss would stay invisible
   * until a later release started reading it. The ref is included verbatim in
   * every PATCH; only "Clear AI attribution" changes it.
   */
  const generatedRef = useRef<Record<string, GeneratedFieldProvenance> | null>(null);
  const [generatedCount, setGeneratedCount] = useState(0);

  const markDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    if (!scenario) return;
    const switched = loadedScenarioIdRef.current !== scenario.id;
    if (!switched && dirty) return;
    loadedScenarioIdRef.current = scenario.id;

    setName(scenario.name);
    setDescription(scenario.description);
    setGenre(scenario.genre ?? "");
    setContentRating(scenario.contentRating ?? "");
    setTags(scenario.tags);
    setFavorite(scenario.favorite);
    setSetting(scenario.setting ?? EMPTY_SETTING);
    setHasSetting(scenario.setting !== null);
    setHasProtagonist(scenario.protagonist !== null);
    setProtagonistName(scenario.protagonist?.name ?? "");
    setProtagonistDescription(scenario.protagonist?.description ?? "");
    setProtagonistBackstory(scenario.protagonist?.backstory ?? "");
    setProtagonistMotivation(scenario.protagonist?.motivation ?? "");
    setProtagonistTraits(scenario.protagonist?.traits ?? []);
    setProtagonistAppearance(scenario.protagonist?.appearance ?? "");
    setNpcs(scenario.npcs);
    setFirstMessage(scenario.firstMessage ?? "");
    setAlternateGreetings(scenario.alternateGreetings);
    setLorebookIds(scenario.lorebookIds);
    generatedRef.current = scenario.generated;
    setGeneratedCount(scenario.generated ? Object.keys(scenario.generated).length : 0);
    setDirty(false);
  }, [scenario, dirty]);

  useEffect(() => {
    setEditorDirty(dirty);
  }, [dirty, setEditorDirty]);

  useEffect(() => {
    if (!isError) return;
    toast.error("Scenario not found");
    closeDetail();
  }, [isError, closeDetail]);

  const updateSetting = useCallback(
    (patch: Partial<ScenarioSetting>) => {
      setSetting((prev) => ({ ...prev, ...patch }));
      setHasSetting(true);
      markDirty();
    },
    [markDirty],
  );

  const handleSave = useCallback(async () => {
    if (!scenario) return;
    if (!name.trim()) {
      toast.error("Scenario needs a name");
      return;
    }
    setSaving(true);
    try {
      await updateScenario.mutateAsync({
        id: scenario.id,
        name: name.trim(),
        description,
        genre: genre.trim() || null,
        contentRating: contentRating || null,
        tags,
        favorite,
        setting: hasSetting ? setting : null,
        protagonist: hasProtagonist
          ? {
              name: protagonistName,
              description: protagonistDescription,
              backstory: protagonistBackstory,
              motivation: protagonistMotivation,
              traits: protagonistTraits,
              appearance: protagonistAppearance.trim() || null,
              characterId: scenario.protagonist?.characterId ?? null,
            }
          : null,
        npcs,
        firstMessage: firstMessage.trim() ? firstMessage : null,
        alternateGreetings,
        lorebookIds,
        // Carried through untouched — see generatedRef above.
        generated: generatedRef.current,
      });
      setDirty(false);
      toast.success("Scenario saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save scenario");
    } finally {
      setSaving(false);
    }
  }, [
    scenario,
    name,
    description,
    genre,
    contentRating,
    tags,
    favorite,
    hasSetting,
    setting,
    hasProtagonist,
    protagonistName,
    protagonistDescription,
    protagonistBackstory,
    protagonistMotivation,
    protagonistTraits,
    protagonistAppearance,
    npcs,
    firstMessage,
    alternateGreetings,
    lorebookIds,
    updateScenario,
  ]);

  const handleClearProvenance = useCallback(async () => {
    if (
      !(await showConfirmDialog({
        title: "Clear AI attribution",
        message:
          "Remove the record of which fields were AI-generated? The field values are not changed. This cannot be undone.",
        confirmLabel: "Clear",
        tone: "destructive",
      }))
    ) {
      return;
    }
    generatedRef.current = null;
    setGeneratedCount(0);
    markDirty();
  }, [markDirty]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
      return;
    }
    closeDetail();
  }, [dirty, closeDetail]);

  const handleDelete = useCallback(async () => {
    if (!scenario) return;
    if (
      await showConfirmDialog({
        title: "Delete scenario",
        message: `Delete ${scenario.name}? This cannot be undone.`,
        confirmLabel: "Delete",
        tone: "destructive",
      })
    ) {
      await deleteScenario.mutateAsync(scenario.id);
      closeDetail();
    }
  }, [scenario, deleteScenario, closeDetail]);

  const handleExport = useCallback(
    async (format: ExportFormatChoice) => {
      if (!scenario) return;
      setShowExportDialog(false);
      const extension = format === "compatible" ? "json" : "marinara.json";
      try {
        await api.download(
          `/scenarios/${scenario.id}/export?format=${format}`,
          `${scenario.name || "scenario"}.${extension}`,
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to export scenario");
      }
    },
    [scenario],
  );

  const lorebookNameById = useMemo(
    () => new Map(lorebooks.map((book) => [book.id, book.name])),
    [lorebooks],
  );

  const externalLinkCount = useMemo(() => {
    if (!scenario) return 0;
    return (
      lorebookIds.length +
      npcs.filter((npc) => npc.characterId).length +
      (scenario.protagonist?.characterId ? 1 : 0)
    );
  }, [scenario, lorebookIds, npcs]);

  if (isLoading || !scenario) return <div className="shimmer h-8 w-48 rounded-xl" />;

  return (
    <div className="mari-editor-panel-root flex h-full min-h-0 flex-col">
      <header className="mari-editor-header">
        <button onClick={handleClose} className="mari-editor-action" title="Back" aria-label="Back">
          <ArrowLeft size="1rem" />
        </button>
        <div className="mari-editor-icon-tile mari-panel-gradient-surface mari-panel-gradient--scenarios">
          <Clapperboard size="1rem" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="mari-editor-title truncate">{name || "Untitled scenario"}</h1>
          <p className="mari-editor-meta truncate">
            {scenario.source === "import" ? "Imported" : "Created here"}
            {scenario.originalFilename ? ` · ${scenario.originalFilename}` : ""}
            {generatedCount > 0 ? ` · ${generatedCount} AI-generated field(s)` : ""}
          </p>
        </div>
        <div className="mari-editor-actions">
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="mari-editor-action mari-editor-action--primary disabled:cursor-not-allowed disabled:opacity-50"
            title="Save"
          >
            {saving ? <Loader2 size="1rem" className="animate-spin" /> : <Save size="1rem" />}
          </button>
          <button
            onClick={() => setShowExportDialog(true)}
            className="mari-editor-action"
            title="Export"
            aria-label="Export"
          >
            <Download size="1rem" />
          </button>
          <button onClick={handleDelete} className="mari-editor-action" title="Delete" aria-label="Delete">
            <Trash2 size="1rem" className="text-[var(--destructive)]" />
          </button>
        </div>
      </header>

      {showUnsavedWarning && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-amber-500/10 px-4 py-2 text-xs">
          <span className="flex-1">You have unsaved changes.</span>
          <button onClick={() => setShowUnsavedWarning(false)} className="mari-chrome-control mari-chrome-control--compact">
            Keep editing
          </button>
          <button
            onClick={() => {
              setShowUnsavedWarning(false);
              setDirty(false);
              closeDetail();
            }}
            className="mari-chrome-control mari-chrome-control--compact mari-chrome-control--danger"
          >
            Discard and close
          </button>
          <button
            onClick={async () => {
              await handleSave();
              setShowUnsavedWarning(false);
              closeDetail();
            }}
            className="mari-chrome-control mari-chrome-control--compact mari-chrome-control--selected"
          >
            Save and close
          </button>
        </div>
      )}

      <div className="mari-editor-body flex min-h-0 flex-1 @container">
        <EditorTabRail tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

        <div className="mari-editor-content min-h-0 flex-1 overflow-y-auto">
          <div className="mari-editor-content-inner mari-editor-content-inner--wide flex flex-col gap-3 p-4">
            {activeTab === "overview" && (
              <>
                <div className="mari-editor-panel">
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Name</label>
                  <input
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      markDirty();
                    }}
                    className="mari-editor-field w-full px-2 py-1.5 text-xs"
                  />
                </div>
                <div className="mari-editor-panel">
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Description</label>
                  <ExpandableTextarea
                    value={description}
                    onChange={(value) => {
                      setDescription(value);
                      markDirty();
                    }}
                    rows={3}
                    placeholder="A short preview shown on library cards."
                  />
                </div>
                <div className="flex gap-2">
                  <div className="mari-editor-panel flex-1">
                    <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">
                      Genre
                      <HelpTooltip text="Feeds the genre field when a game is set up from this scenario." />
                    </label>
                    <input
                      value={genre}
                      onChange={(event) => {
                        setGenre(event.target.value);
                        markDirty();
                      }}
                      list="scenario-genre-suggestions"
                      className="mari-editor-field w-full px-2 py-1.5 text-xs"
                    />
                    <datalist id="scenario-genre-suggestions">
                      <option value="Fantasy" />
                      <option value="Science fiction" />
                      <option value="Gothic horror" />
                      <option value="Mystery" />
                      <option value="Slice of life" />
                    </datalist>
                  </div>
                  <div className="mari-editor-panel flex-1">
                    <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">
                      Content rating
                      <HelpTooltip text="Left unspecified, whatever starts a story from this scenario will ask instead of assuming." />
                    </label>
                    <select
                      value={contentRating}
                      onChange={(event) => {
                        setContentRating(event.target.value as "" | "sfw" | "nsfw");
                        markDirty();
                      }}
                      className="mari-editor-field w-full px-2 py-1.5 text-xs"
                    >
                      <option value="">Unspecified</option>
                      <option value="sfw">SFW</option>
                      <option value="nsfw">NSFW</option>
                    </select>
                  </div>
                </div>
                <ChipListField
                  label="Tags"
                  values={tags}
                  onChange={(next) => {
                    setTags(next);
                    markDirty();
                  }}
                  placeholder="Add tags, comma separated"
                />
                <div className="mari-editor-panel flex items-center gap-2">
                  <input
                    id="scenario-favorite"
                    type="checkbox"
                    checked={favorite}
                    onChange={(event) => {
                      setFavorite(event.target.checked);
                      markDirty();
                    }}
                  />
                  <label htmlFor="scenario-favorite" className="text-xs">
                    Favorite
                  </label>
                </div>

                {generatedCount > 0 && (
                  <div className="mari-editor-panel flex flex-wrap items-center gap-2">
                    <Sparkles size="0.875rem" className="text-[var(--primary)]" />
                    <span className="flex-1 text-xs">
                      {generatedCount} field(s) are recorded as AI-generated.
                      <HelpTooltip text="Provenance travels with the scenario when it is exported. Clearing it does not change any field values." />
                    </span>
                    <button
                      onClick={handleClearProvenance}
                      className="mari-chrome-control mari-chrome-control--compact"
                    >
                      Clear AI attribution
                    </button>
                  </div>
                )}
              </>
            )}

            {activeTab === "setting" && (
              <>
                <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                  Write the setting directly. Every field here is optional and hand-authored.
                </p>
                <div className="mari-editor-panel">
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Setting name</label>
                  <input
                    value={setting.name}
                    onChange={(event) => updateSetting({ name: event.target.value })}
                    className="mari-editor-field w-full px-2 py-1.5 text-xs"
                  />
                </div>
                <div className="mari-editor-panel">
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Description</label>
                  <ExpandableTextarea
                    value={setting.description}
                    onChange={(value) => updateSetting({ description: value })}
                    rows={8}
                    placeholder="The world, its rules, and its atmosphere."
                    title="Setting description"
                  />
                </div>
                <div className="mari-editor-panel">
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">Atmosphere</label>
                  <ExpandableTextarea
                    value={setting.atmosphere}
                    onChange={(value) => updateSetting({ atmosphere: value })}
                    rows={2}
                  />
                </div>
                <ChipListField
                  label="Themes"
                  values={setting.themes}
                  onChange={(next) => updateSetting({ themes: next })}
                  placeholder="Add themes, comma separated"
                />
                <ChipListField
                  label="Potential conflicts"
                  values={setting.potentialConflicts}
                  onChange={(next) => updateSetting({ potentialConflicts: next })}
                  placeholder="Add story hooks, comma separated"
                />
                <div className="mari-editor-panel">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[0.6875rem] text-[var(--muted-foreground)]">Key locations</label>
                    <button
                      onClick={() =>
                        updateSetting({ keyLocations: [...setting.keyLocations, { name: "", description: "" }] })
                      }
                      className="mari-chrome-control mari-chrome-control--compact"
                    >
                      <Plus size="0.6875rem" />
                      Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-2">
                    {setting.keyLocations.map((location, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          value={location.name}
                          onChange={(event) => {
                            const next = [...setting.keyLocations];
                            next[index] = { ...location, name: event.target.value };
                            updateSetting({ keyLocations: next });
                          }}
                          placeholder="Name"
                          className="mari-editor-field w-1/3 px-2 py-1.5 text-xs"
                        />
                        <input
                          value={location.description}
                          onChange={(event) => {
                            const next = [...setting.keyLocations];
                            next[index] = { ...location, description: event.target.value };
                            updateSetting({ keyLocations: next });
                          }}
                          placeholder="Description"
                          className="mari-editor-field flex-1 px-2 py-1.5 text-xs"
                        />
                        <button
                          onClick={() =>
                            updateSetting({ keyLocations: setting.keyLocations.filter((_, i) => i !== index) })
                          }
                          className="mari-chrome-control mari-chrome-control--small p-1.5"
                          aria-label="Remove location"
                        >
                          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "cast" && (
              <>
                <div className="mari-editor-panel">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold">Protagonist</span>
                    <button
                      onClick={() => {
                        setHasProtagonist(!hasProtagonist);
                        markDirty();
                      }}
                      className="mari-chrome-control mari-chrome-control--compact"
                    >
                      {hasProtagonist ? "Remove" : "Add protagonist"}
                    </button>
                  </div>
                  {hasProtagonist ? (
                    <div className="flex flex-col gap-2">
                      <input
                        value={protagonistName}
                        onChange={(event) => {
                          setProtagonistName(event.target.value);
                          markDirty();
                        }}
                        placeholder="Name"
                        className="mari-editor-field w-full px-2 py-1.5 text-xs"
                      />
                      <ExpandableTextarea
                        value={protagonistDescription}
                        onChange={(value) => {
                          setProtagonistDescription(value);
                          markDirty();
                        }}
                        rows={2}
                        placeholder="Who they are"
                      />
                      <ExpandableTextarea
                        value={protagonistBackstory}
                        onChange={(value) => {
                          setProtagonistBackstory(value);
                          markDirty();
                        }}
                        rows={2}
                        placeholder="Backstory"
                      />
                      <ExpandableTextarea
                        value={protagonistMotivation}
                        onChange={(value) => {
                          setProtagonistMotivation(value);
                          markDirty();
                        }}
                        rows={2}
                        placeholder="What drives them"
                      />
                      <input
                        value={protagonistAppearance}
                        onChange={(event) => {
                          setProtagonistAppearance(event.target.value);
                          markDirty();
                        }}
                        placeholder="Appearance (optional)"
                        className="mari-editor-field w-full px-2 py-1.5 text-xs"
                      />
                      <ChipListField
                        label="Traits"
                        values={protagonistTraits}
                        onChange={(next) => {
                          setProtagonistTraits(next);
                          markDirty();
                        }}
                        placeholder="Add traits, comma separated"
                      />
                    </div>
                  ) : (
                    <p className="text-[0.6875rem] text-[var(--muted-foreground)]">
                      No protagonist. Normal for a second-person scenario.
                    </p>
                  )}
                </div>

                <div className="mari-editor-panel">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold">Supporting cast</span>
                    <button
                      onClick={() => {
                        setNpcs([...npcs, blankNpc()]);
                        markDirty();
                      }}
                      className="mari-chrome-control mari-chrome-control--compact"
                    >
                      <Plus size="0.6875rem" />
                      Add
                    </button>
                  </div>
                  <div className="flex flex-col gap-3">
                    {npcs.map((npc, index) => (
                      <div key={npc.id} className="rounded-lg border border-[var(--border)] p-2">
                        <div className="mb-2 flex gap-2">
                          <input
                            value={npc.name}
                            onChange={(event) => {
                              const next = [...npcs];
                              next[index] = { ...npc, name: event.target.value };
                              setNpcs(next);
                              markDirty();
                            }}
                            placeholder="Name"
                            className="mari-editor-field flex-1 px-2 py-1.5 text-xs"
                          />
                          <input
                            value={npc.role}
                            onChange={(event) => {
                              const next = [...npcs];
                              next[index] = { ...npc, role: event.target.value };
                              setNpcs(next);
                              markDirty();
                            }}
                            placeholder="Role"
                            className="mari-editor-field w-1/3 px-2 py-1.5 text-xs"
                          />
                          <button
                            onClick={() => {
                              setNpcs(npcs.filter((_, i) => i !== index));
                              markDirty();
                            }}
                            className="mari-chrome-control mari-chrome-control--small p-1.5"
                            aria-label="Remove cast member"
                          >
                            <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                          </button>
                        </div>
                        <input
                          value={npc.description}
                          onChange={(event) => {
                            const next = [...npcs];
                            next[index] = { ...npc, description: event.target.value };
                            setNpcs(next);
                            markDirty();
                          }}
                          placeholder="Description"
                          className="mari-editor-field mb-2 w-full px-2 py-1.5 text-xs"
                        />
                        <input
                          value={npc.relationship}
                          onChange={(event) => {
                            const next = [...npcs];
                            next[index] = { ...npc, relationship: event.target.value };
                            setNpcs(next);
                            markDirty();
                          }}
                          placeholder="Relationship to the protagonist"
                          className="mari-editor-field w-full px-2 py-1.5 text-xs"
                        />
                        {npc.characterId && (
                          <p className="mt-2 text-[0.625rem] text-[var(--muted-foreground)]">
                            Linked to a character card.
                          </p>
                        )}
                      </div>
                    ))}
                    {npcs.length === 0 && (
                      <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No cast members yet.</p>
                    )}
                  </div>
                </div>
              </>
            )}

            {activeTab === "opening" && (
              <>
                <div className="mari-editor-panel">
                  <label className="mb-1 block text-[0.6875rem] text-[var(--muted-foreground)]">First message</label>
                  <ExpandableTextarea
                    value={firstMessage}
                    onChange={(value) => {
                      setFirstMessage(value);
                      markDirty();
                    }}
                    rows={6}
                    placeholder="The opening narration. Leave empty to open with a generated scene."
                    title="First message"
                  />
                </div>
                <div className="mari-editor-panel">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="text-[0.6875rem] text-[var(--muted-foreground)]">Alternate greetings</label>
                    <button
                      onClick={() => {
                        setAlternateGreetings([...alternateGreetings, ""]);
                        markDirty();
                      }}
                      className="mari-chrome-control mari-chrome-control--compact"
                    >
                      <Plus size="0.6875rem" />
                      Add
                    </button>
                  </div>
                  {!firstMessage.trim() && alternateGreetings.length > 0 && (
                    <button
                      onClick={() => {
                        setFirstMessage(alternateGreetings[0]);
                        setAlternateGreetings(alternateGreetings.slice(1));
                        markDirty();
                      }}
                      className="mari-chrome-control mari-chrome-control--compact mb-2"
                    >
                      Promote the first alternate to the opening
                    </button>
                  )}
                  <div className="flex flex-col gap-2">
                    {alternateGreetings.map((greeting, index) => (
                      <div key={index} className="flex gap-2">
                        <textarea
                          value={greeting}
                          onChange={(event) => {
                            const next = [...alternateGreetings];
                            next[index] = event.target.value;
                            setAlternateGreetings(next);
                            markDirty();
                          }}
                          rows={3}
                          className="mari-editor-field flex-1 px-2 py-1.5 text-xs"
                        />
                        <button
                          onClick={() => {
                            setAlternateGreetings(alternateGreetings.filter((_, i) => i !== index));
                            markDirty();
                          }}
                          className="mari-chrome-control mari-chrome-control--small h-fit p-1.5"
                          aria-label="Remove greeting"
                        >
                          <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {activeTab === "links" && (
              <div className="mari-editor-panel">
                <label className="mb-2 block text-[0.6875rem] text-[var(--muted-foreground)]">
                  Linked lorebooks
                  <HelpTooltip text="Links travel as ids. On another install they only resolve if the same lorebook is already there." />
                </label>
                <div className="mb-3 flex flex-wrap gap-1">
                  {lorebookIds.map((id) => {
                    const missing = !lorebookNameById.has(id);
                    return (
                      <span
                        key={id}
                        className={cn(
                          "mari-editor-chip",
                          missing ? "opacity-60" : "mari-editor-chip--accent",
                        )}
                        title={missing ? "This lorebook is not on this install" : undefined}
                      >
                        {missing ? `Missing (${id})` : lorebookNameById.get(id)}
                        <button
                          onClick={() => {
                            setLorebookIds(lorebookIds.filter((value) => value !== id));
                            markDirty();
                          }}
                          aria-label="Unlink lorebook"
                        >
                          <X size="0.625rem" />
                        </button>
                      </span>
                    );
                  })}
                  {lorebookIds.length === 0 && (
                    <p className="text-[0.6875rem] text-[var(--muted-foreground)]">No lorebooks linked.</p>
                  )}
                </div>
                <select
                  value=""
                  onChange={(event) => {
                    const id = event.target.value;
                    if (!id || lorebookIds.includes(id)) return;
                    setLorebookIds([...lorebookIds, id]);
                    markDirty();
                  }}
                  className="mari-editor-field w-full px-2 py-1.5 text-xs"
                  aria-label="Link a lorebook"
                >
                  <option value="">Link a lorebook…</option>
                  {lorebooks
                    .filter((book) => !lorebookIds.includes(book.id))
                    .map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.name}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        </div>
      </div>

      <ExportFormatDialog
        open={showExportDialog}
        title="Export Scenario"
        description="Native keeps every Marinara field. Compatible JSON matches the scenario shape other roleplay tools read."
        nativeDescription="Keeps the structured setting, cast links, play hints and AI attribution."
        compatibleDescription="Flattens the setting to a single field for tools that read the folderless scenario shape."
        notice={
          externalLinkCount > 0
            ? `This scenario links ${externalLinkCount} item(s). Links travel as ids, so they will not resolve on an install that does not already have them.`
            : undefined
        }
        onClose={() => setShowExportDialog(false)}
        onSelect={handleExport}
      />
    </div>
  );
}
