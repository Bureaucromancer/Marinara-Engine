// ──────────────────────────────────────────────
// Panel: Scenarios
// Search, favourite filter, tags, folders, click-to-edit
//
// Structurally a sibling of LorebooksPanel. Differences worth knowing:
//   - no category axis (scenarios have none), so filtering is favourites + tags
//   - duplicate is a server call, not a client-side rebuild
//   - scenarios do not participate in chat drag/drop, so no ChatResourceActionButton
// ──────────────────────────────────────────────
import { useState, useMemo, useCallback, useEffect, useRef, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import {
  Plus,
  Copy,
  Download,
  Check,
  Clapperboard,
  Search,
  ArrowUpDown,
  Tag,
  ChevronRight,
  FolderPlus,
  X,
  Trash2,
  Camera,
  Star,
} from "lucide-react";
import { useUIStore, type ScenarioPanelSort } from "../../stores/ui.store";
import type { CharacterPanelFavoriteFilter } from "../../stores/ui.store";
import {
  fetchAllScenarioPages,
  flattenScenarioPages,
  useScenarioPages,
  useDeleteScenario,
  useDuplicateScenario,
  useUpdateScenario,
  useUploadScenarioImage,
} from "../../hooks/use-scenarios";
import type { Scenario } from "@marinara-engine/shared";
import { confirmNonEmptyFolderDelete, showConfirmDialog } from "../../lib/app-dialogs";
import { cn } from "../../lib/utils";
import { api } from "../../lib/api-client";
import {
  getNextUnnamedLibraryFolderName,
  useCreateLibraryFolder,
  useDeleteLibraryFolder,
  useLibraryFolders,
  useMoveLibraryItem,
  useUpdateLibraryFolder,
} from "../../hooks/use-library-folders";
import { handleFolderRenameKeyDown, useFolderRenameGesture } from "../../hooks/use-folder-rename-gesture";
import { useTouchFolderDrag } from "../../hooks/use-touch-folder-drag";
import { SelectionActionBar } from "../ui/SelectionActionBar";
import { SmoothFolderContent } from "../ui/SmoothFolderContent";
import { TouchDragHandle } from "../ui/TouchDragHandle";
import { useLocalizedUiText } from "../../localization/use-localized-ui-text";
import { PanelLoadMoreBar } from "./PanelLoadMoreBar";
import { useTranslation as useUiTranslation } from "react-i18next";

const FAVORITE_FILTERS: Array<{ id: CharacterPanelFavoriteFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "favorites", label: "Favs" },
  { id: "non-favorites", label: "Non-favs" },
];

const SORT_OPTIONS: Array<{ id: ScenarioPanelSort; label: string }> = [
  { id: "name-asc", label: "A-Z" },
  { id: "name-desc", label: "Z-A" },
  { id: "newest", label: "Newest" },
  { id: "oldest", label: "Oldest" },
  { id: "favorites", label: "Favorites" },
];

function usePanelMobileOverlay() {
  const [isMobileOverlay, setIsMobileOverlay] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobileOverlay(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobileOverlay;
}

export function ScenariosPanel() {
  const { t: localizeUi } = useUiTranslation();
  const localize = useLocalizedUiText();
  const searchQuery = useUIStore((s) => s.scenarioPanelSearch);
  const setSearchQuery = useUIStore((s) => s.setScenarioPanelSearch);
  const sort = useUIStore((s) => s.scenarioPanelSort);
  const setSort = useUIStore((s) => s.setScenarioPanelSort);
  const activeTag = useUIStore((s) => s.scenarioPanelActiveTag);
  const setActiveTag = useUIStore((s) => s.setScenarioPanelActiveTag);
  const tagsExpanded = useUIStore((s) => s.scenarioPanelTagsExpanded);
  const setTagsExpanded = useUIStore((s) => s.setScenarioPanelTagsExpanded);
  const favoriteFilter = useUIStore((s) => s.scenarioPanelFavoriteFilter);
  const setFavoriteFilter = useUIStore((s) => s.setScenarioPanelFavoriteFilter);
  const openModal = useUIStore((s) => s.openModal);
  const openScenarioDetail = useUIStore((s) => s.openScenarioDetail);

  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<Set<string>>(new Set());
  const [exportingSelected, setExportingSelected] = useState(false);
  const isMobileOverlay = usePanelMobileOverlay();
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [draggedScenarioId, setDraggedScenarioId] = useState<string | null>(null);
  const scenarioImageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetScenarioIdRef = useRef<string | null>(null);
  const suppressScenarioClickRef = useRef(false);
  const handleFolderRenameGesture = useFolderRenameGesture();

  const serverFavoriteFilter = favoriteFilter === "all" ? "" : favoriteFilter;
  const scenarioPages = useScenarioPages({ search: searchQuery, sort, favoriteFilter: serverFavoriteFilter });
  const scenarios = useMemo(() => flattenScenarioPages(scenarioPages.data), [scenarioPages.data]);
  const isLoading = scenarioPages.isLoading;

  const deleteScenario = useDeleteScenario();
  const duplicateScenario = useDuplicateScenario();
  const updateScenario = useUpdateScenario();
  const uploadScenarioImage = useUploadScenarioImage();
  const { data: scenarioFolders = [] } = useLibraryFolders("scenarios");
  const createScenarioFolder = useCreateLibraryFolder("scenarios");
  const updateScenarioFolder = useUpdateLibraryFolder("scenarios");
  const deleteScenarioFolder = useDeleteLibraryFolder("scenarios");
  const moveScenarioItem = useMoveLibraryItem("scenarios");

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const scenario of scenarios) for (const tag of scenario.tags ?? []) tagSet.add(tag);
    return Array.from(tagSet).sort();
  }, [scenarios]);

  const handleDeleteTag = useCallback(
    async (tag: string) => {
      if (
        !(await showConfirmDialog({
          title:localizeUi("ui.panels.scenariospanel.removeTag"),
          message:localizeUi("ui.panels.scenariospanel.removeValue1FromAllScenarios", { value1: tag }),
          confirmLabel:localizeUi("settings.notifications.customSound.actions.remove"),
          tone: "destructive",
        }))
      ) {
        return;
      }
      try {
        const all = await fetchAllScenarioPages({ sort });
        const affected = all.filter((scenario) => (scenario.tags ?? []).includes(tag));
        for (const scenario of affected) {
          await updateScenario.mutateAsync({ id: scenario.id, tags: (scenario.tags ?? []).filter((t) => t !== tag) });
        }
        if (activeTag === tag) setActiveTag(null);
      } catch {
        toast.error(localizeUi("ui.panels.scenariospanel.failedToRemoveTagFromSomeScenarios"));
      }
    },
    [sort, updateScenario, activeTag, setActiveTag, localizeUi],
  );

  // Search and favourites are applied server-side; the tag filter is local
  // because tags live in a JSON column with no index worth adding yet.
  const filtered = useMemo(() => {
    if (!activeTag) return scenarios;
    return scenarios.filter((scenario) => (scenario.tags ?? []).includes(activeTag));
  }, [scenarios, activeTag]);

  const scenarioById = useMemo(() => new Map(filtered.map((scenario) => [scenario.id, scenario])), [filtered]);
  const folderFilterActive = searchQuery.trim().length > 0 || activeTag !== null || favoriteFilter !== "all";

  const folderedScenarioIds = useMemo(() => {
    const ids = new Set<string>();
    for (const folder of scenarioFolders) for (const id of folder.itemIds) ids.add(id);
    return ids;
  }, [scenarioFolders]);

  const rootScenarios = useMemo(
    () => filtered.filter((scenario) => !folderedScenarioIds.has(scenario.id)),
    [filtered, folderedScenarioIds],
  );

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedScenarioIds(new Set());
  }, []);

  const toggleSelection = useCallback((scenarioId: string) => {
    setSelectedScenarioIds((prev) => {
      const next = new Set(prev);
      if (next.has(scenarioId)) next.delete(scenarioId);
      else next.add(scenarioId);
      return next;
    });
  }, []);

  const handleExportSelected = useCallback(async () => {
    if (selectedScenarioIds.size === 0) return;
    setExportingSelected(true);
    try {
      await api.downloadPost(
        "/scenarios/export-bulk",
        { ids: [...selectedScenarioIds], format: "native" },
        "marinara-scenarios.zip",
      );
      toast.success(localizeUi("ui.panels.scenariospanel.exportedValue1ScenarioS", { value1: selectedScenarioIds.size }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message :localizeUi("ui.panels.scenariospanel.failedToExportScenarios"));
    } finally {
      setExportingSelected(false);
    }
  }, [selectedScenarioIds, localizeUi]);

  const handleDeleteSelected = useCallback(async () => {
    const ids = [...selectedScenarioIds];
    if (ids.length === 0) return;

    if (
      !(await showConfirmDialog({
        title:localizeUi("ui.panels.scenariospanel.deleteScenarios"),
        message:localizeUi("ui.panels.scenariospanel.deleteValue1ScenarioSThisCannotBeUndone", { value1: ids.length }),
        confirmLabel:localizeUi("lorebook.editor.batch.delete"),
        tone: "destructive",
      }))
    ) {
      return;
    }

    const results = await Promise.allSettled(ids.map((id) => deleteScenario.mutateAsync(id)));
    const failedIds = ids.filter((_, index) => results[index]?.status === "rejected");
    const deletedCount = ids.length - failedIds.length;

    if (deletedCount > 0) toast.success(localizeUi("ui.panels.scenariospanel.deletedValue1ScenarioS", { value1: deletedCount }));
    if (failedIds.length > 0) {
      setSelectedScenarioIds(new Set(failedIds));
      toast.error(localizeUi("ui.panels.scenariospanel.failedToDeleteValue1ScenarioS", { value1: failedIds.length }));
      return;
    }
    exitSelectionMode();
  }, [selectedScenarioIds, deleteScenario, exitSelectionMode, localizeUi]);

  const handlePickScenarioImage = useCallback((scenarioId: string) => {
    imageTargetScenarioIdRef.current = scenarioId;
    if (scenarioImageInputRef.current) {
      scenarioImageInputRef.current.value = "";
      scenarioImageInputRef.current.click();
    }
  }, []);

  const handleDuplicateScenario = useCallback(
    async (scenario: Scenario) => {
      try {
        const created = await duplicateScenario.mutateAsync(scenario.id);
        toast.success(localizeUi("ui.panels.scenariospanel.copiedValue1", { value1: scenario.name }));
        openScenarioDetail(created.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message :localizeUi("ui.panels.scenariospanel.failedToCopyScenario"));
      }
    },
    [duplicateScenario, openScenarioDetail, localizeUi],
  );

  const handleScenarioImageSelected = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      const scenarioId = imageTargetScenarioIdRef.current;
      if (!file || !scenarioId) return;
      imageTargetScenarioIdRef.current = null;

      if (!file.type.startsWith("image/")) {
        toast.error(localizeUi("ui.panels.scenariospanel.pleaseChooseAnImageFile"));
        return;
      }

      const reader = new FileReader();
      reader.onload = async () => {
        const image = typeof reader.result === "string" ? reader.result : null;
        if (!image) return;
        try {
          await uploadScenarioImage.mutateAsync({ id: scenarioId, image });
          toast.success(localizeUi("ui.panels.scenariospanel.scenarioImageUpdated"));
        } catch (error) {
          toast.error(error instanceof Error ? error.message :localizeUi("ui.panels.scenariospanel.failedToUpdateScenarioImage"));
        }
      };
      reader.readAsDataURL(file);
    },
    [uploadScenarioImage, localizeUi],
  );

  const handleToggleFavorite = useCallback(
    (scenario: Scenario) => {
      updateScenario.mutate({ id: scenario.id, favorite: !scenario.favorite });
    },
    [updateScenario],
  );

  const handleCreateFolder = useCallback(() => {
    createScenarioFolder.mutate(
      { name: getNextUnnamedLibraryFolderName(scenarioFolders) },
      { onSuccess: (folder) => setExpandedFolderId(folder.id) },
    );
  }, [createScenarioFolder, scenarioFolders]);

  const handleRenameFolder = useCallback(
    (folderId: string) => {
      const name = editFolderName.trim();
      if (name) updateScenarioFolder.mutate({ id: folderId, name });
      setEditingFolderId(null);
      setEditFolderName("");
    },
    [editFolderName, updateScenarioFolder],
  );

  const getDraggedScenarioIds = useCallback(
    (scenarioId: string) =>
      selectionMode && selectedScenarioIds.has(scenarioId) ? Array.from(selectedScenarioIds) : [scenarioId],
    [selectedScenarioIds, selectionMode],
  );

  const moveScenariosToFolder = useCallback(
    (scenarioIds: string[], folderId: string | null) => {
      moveScenarioItem.mutate({ itemIds: scenarioIds, folderId });
    },
    [moveScenarioItem],
  );

  const handleScenarioDrop = useCallback(
    (folderId: string | null, scenarioIds?: string[]) => {
      if (!draggedScenarioId) return;
      moveScenariosToFolder(scenarioIds ?? [draggedScenarioId], folderId);
      setDraggedScenarioId(null);
    },
    [draggedScenarioId, moveScenariosToFolder],
  );

  const finishScenarioTouchDrag = useCallback(
    (scenarioId: string, x: number, y: number) => {
      const target = document.elementFromPoint(x, y);
      const folderElement = target?.closest("[data-scenario-folder-id]") as HTMLElement | null;
      const rootElement = target?.closest("[data-scenario-folder-root]") as HTMLElement | null;
      if (folderElement?.dataset.scenarioFolderId) {
        moveScenariosToFolder(getDraggedScenarioIds(scenarioId), folderElement.dataset.scenarioFolderId);
      } else if (rootElement) {
        moveScenariosToFolder(getDraggedScenarioIds(scenarioId), null);
      }
      setDraggedScenarioId(null);
      window.setTimeout(() => {
        suppressScenarioClickRef.current = false;
      }, 0);
    },
    [getDraggedScenarioIds, moveScenariosToFolder],
  );

  const cancelScenarioTouchDrag = useCallback((_scenarioId: string, wasActive: boolean) => {
    setDraggedScenarioId(null);
    if (wasActive) {
      window.setTimeout(() => {
        suppressScenarioClickRef.current = false;
      }, 0);
    } else {
      suppressScenarioClickRef.current = false;
    }
  }, []);

  const { startTouchDrag: startScenarioTouchDrag } = useTouchFolderDrag({
    onActivate: (scenarioId) => {
      suppressScenarioClickRef.current = true;
      setDraggedScenarioId(scenarioId);
    },
    onDrop: finishScenarioTouchDrag,
    onCancel: cancelScenarioTouchDrag,
  });

  const renderScenarioRow = useCallback(
    (scenario: Scenario) => (
      <ScenarioRow
        key={scenario.id}
        scenario={scenario}
        onClick={() => {
          if (suppressScenarioClickRef.current) return;
          if (selectionMode) toggleSelection(scenario.id);
          else openScenarioDetail(scenario.id);
        }}
        onDelete={async () => {
          if (
            await showConfirmDialog({
              title:localizeUi("ui.panels.scenariospanel.deleteScenario"),
              message:localizeUi("ui.panels.scenariospanel.deleteValue1ThisCannotBeUndone", { value1: scenario.name }),
              confirmLabel:localizeUi("lorebook.editor.batch.delete"),
              tone: "destructive",
            })
          ) {
            deleteScenario.mutate(scenario.id);
          }
        }}
        onDuplicate={() => void handleDuplicateScenario(scenario)}
        onImagePick={() => handlePickScenarioImage(scenario.id)}
        onToggleFavorite={() => handleToggleFavorite(scenario)}
        selectionMode={selectionMode}
        isSelected={selectedScenarioIds.has(scenario.id)}
        onToggleSelect={() => toggleSelection(scenario.id)}
        draggable={!isMobileOverlay}
        isDragging={draggedScenarioId === scenario.id}
        onDragStart={(event) => {
          if (isMobileOverlay) return;
          const ids = getDraggedScenarioIds(scenario.id);
          setDraggedScenarioId(scenario.id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-marinara-scenario-ids", JSON.stringify(ids));
          event.dataTransfer.setData("text/plain", scenario.id);
        }}
        onDragEnd={() => setDraggedScenarioId(null)}
        onTouchStart={(event) => {
          startScenarioTouchDrag(event, scenario.id, {
            allowInteractiveTarget: true,
            sourceElement: event.currentTarget.closest<HTMLElement>('[data-touch-drag-card="scenario"]'),
          });
        }}
      />
    ),
    [
      deleteScenario,
      draggedScenarioId,
      getDraggedScenarioIds,
      handleDuplicateScenario,
      handlePickScenarioImage,
      handleToggleFavorite,
      isMobileOverlay,
      openScenarioDetail,
      selectedScenarioIds,
      selectionMode,
      startScenarioTouchDrag,
      toggleSelection,
      localizeUi,
    ],
  );

  return (
    <div className="flex min-h-full flex-col gap-2 p-3">
      <input
        ref={scenarioImageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleScenarioImageSelected}
      />

      <div className="flex gap-2">
        <button
          onClick={() => openModal("create-scenario")}
          className="mari-panel-gradient-button mari-panel-gradient--scenarios flex-1"
          title={localizeUi("ui.panels.scenariospanel.newScenario")}
        >
          <Plus size="0.8125rem" />
        </button>
        <button
          onClick={() => openModal("import-scenario")}
          className="mari-chrome-control mari-chrome-control--primary flex-1"
          title={localizeUi("ui.panels.scenariospanel.importScenario")}
        >
          <Download size="0.8125rem" />
        </button>
        <button
          onClick={() => (selectionMode ? exitSelectionMode() : setSelectionMode(true))}
          className={cn(
            "mari-chrome-control mari-chrome-control--primary flex-1",
            selectionMode && "mari-chrome-control--selected",
          )}
          title={localizeUi("ui.panels.scenariospanel.selectScenarios")}
        >
          <Check size="0.8125rem" />
        </button>
      </div>

      <div className="flex gap-1.5">
        <div className="relative flex-1">
          <Search
            size="0.75rem"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={localize("Search scenarios")}
            className="mari-chrome-field h-10 w-full rounded-xl pl-8 pr-3 text-xs md:h-9"
          />
        </div>
        <div className="relative">
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as ScenarioPanelSort)}
            className="mari-chrome-field mari-chrome-sort-field mari-accent-animated h-10 rounded-xl pl-2 pr-7 text-xs md:h-9"
            aria-label={localizeUi("ui.panels.scenariospanel.sortScenarios")}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <ArrowUpDown
            size="0.75rem"
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
        </div>
      </div>

      <div className="flex gap-1">
        <button onClick={handleCreateFolder} className="mari-chrome-control mari-chrome-control--small flex-1 justify-start">
          <FolderPlus size="0.75rem" />{localizeUi("ui.panels.backgroundpicker.newFolder")}</button>
      </div>
      {scenarioFolders.length > 0 && (
        <p className="mari-folder-helper">{localizeUi("ui.panels.scenariospanel.dragAndDropScenariosToFoldersDoubleClickOr")}</p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {FAVORITE_FILTERS.map((option) => (
          <button
            key={option.id}
            onClick={() => setFavoriteFilter(option.id)}
            className={cn(
              "mari-chrome-control mari-chrome-control--compact",
              favoriteFilter === option.id && "mari-chrome-control--selected",
            )}
          >
            {option.label}
          </button>
        ))}
        <button
          onClick={() => setTagsExpanded(!tagsExpanded)}
          className={cn("mari-chrome-control mari-chrome-control--compact", activeTag && "mari-chrome-control--selected")}
        >
          <Tag size="0.6875rem" />{localizeUi("ui.characters.metadatatab.tags")}</button>
      </div>

      {tagsExpanded && (
        <div className="flex flex-wrap items-center gap-1">
          {activeTag && (
            <button
              onClick={() => setActiveTag(null)}
              className="mari-chrome-control mari-chrome-control--compact mari-chrome-control--danger"
            >
              <X size="0.6875rem" />{localizeUi("lorebook.editor.batch.clear")}</button>
          )}
          {allTags.map((tag) => (
            <div
              key={tag}
              role="button"
              tabIndex={0}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setActiveTag(activeTag === tag ? null : tag);
              }}
              className={cn(
                "mari-chrome-control mari-chrome-control--compact group/tag",
                activeTag === tag && "mari-chrome-control--selected",
              )}
            >
              {tag}
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void handleDeleteTag(tag);
                }}
                className="opacity-0 transition-opacity group-hover/tag:opacity-100"
                title={localizeUi("ui.panels.scenariospanel.removeTagFromAllScenarios")}
                aria-label={localizeUi("ui.panels.scenariospanel.removeTagFromAllScenarios")}
              >
                <X size="0.625rem" />
              </button>
            </div>
          ))}
        </div>
      )}

      {scenarioFolders.map((folder) => {
        const folderItems = folder.itemIds
          .map((id) => scenarioById.get(id))
          .filter((scenario): scenario is Scenario => Boolean(scenario));
        if (folderFilterActive && folderItems.length === 0) return null;
        const isExpanded = folderFilterActive || expandedFolderId === folder.id;

        return (
          <div
            key={folder.id}
            data-scenario-folder-id={folder.id}
            onDragOver={(event: DragEvent) => {
              if (draggedScenarioId) event.preventDefault();
            }}
            onDrop={(event: DragEvent) => {
              event.preventDefault();
              const raw = event.dataTransfer.getData("application/x-marinara-scenario-ids");
              let ids: string[] | undefined;
              try {
                ids = raw ? (JSON.parse(raw) as string[]) : undefined;
              } catch {
                ids = undefined;
              }
              handleScenarioDrop(folder.id, ids);
            }}
          >
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              onClick={(event) =>
                handleFolderRenameGesture(folder.id, event, {
                  onSingleClick: () => setExpandedFolderId(isExpanded ? null : folder.id),
                  onRename: () => {
                    setEditingFolderId(folder.id);
                    setEditFolderName(folder.name);
                  },
                })
              }
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                handleFolderRenameKeyDown(event, {
                  onSingleClick: () => setExpandedFolderId(isExpanded ? null : folder.id),
                  onRename: () => {
                    setEditingFolderId(folder.id);
                    setEditFolderName(folder.name);
                  },
                });
              }}
              className="group relative flex cursor-pointer items-center gap-2 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]"
            >
              <ChevronRight
                size="0.75rem"
                className={cn("shrink-0 transition-transform", isExpanded && "rotate-90")}
              />
              {editingFolderId === folder.id ? (
                <input
                  autoFocus
                  value={editFolderName}
                  onChange={(event) => setEditFolderName(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") {
                      setEditingFolderId(null);
                      setEditFolderName("");
                    }
                  }}
                  onBlur={() => handleRenameFolder(folder.id)}
                  className="mari-chrome-field min-w-0 flex-1 rounded-lg px-2 py-1 text-xs"
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{folder.name}</span>
              )}
              <span className="shrink-0 text-[0.625rem] text-[var(--muted-foreground)]">{folder.itemIds.length}</span>
              <div className="absolute right-2 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
                <button
                  onClick={async (event) => {
                    event.stopPropagation();
                    if (
                      await confirmNonEmptyFolderDelete(folder.itemIds.length, {
                        title: "Delete folder",
                        message: `Delete "${folder.name}"? The scenarios inside will move back to the main list.`,
                        confirmLabel: "Delete",
                        tone: "destructive",
                      })
                    ) {
                      deleteScenarioFolder.mutate(folder.id);
                      if (expandedFolderId === folder.id) setExpandedFolderId(null);
                    }
                  }}
                  className="mari-chrome-control mari-chrome-control--small p-1.5"
                  title={localizeUi("ui.panels.backgroundpicker.deleteFolder")}
                  aria-label={localizeUi("ui.panels.backgroundpicker.deleteFolder")}
                >
                  <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
                </button>
              </div>
            </div>
            <SmoothFolderContent
              open={isExpanded}
              className="ml-4 border-l border-[var(--border)] pl-2"
              innerClassName="flex flex-col gap-0.5"
            >
              {folderItems.length === 0 ? (
                <p className="px-2 py-3 text-[0.6875rem] italic text-[var(--muted-foreground)]">{localizeUi("ui.panels.scenariospanel.dropScenariosHere")}</p>
              ) : (
                folderItems.map(renderScenarioRow)
              )}
            </SmoothFolderContent>
          </div>
        );
      })}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="shimmer h-14 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="mari-panel-gradient-surface mari-panel-gradient--scenarios flex h-12 w-12 items-center justify-center rounded-2xl shadow-lg">
            <Clapperboard size="1.25rem" />
          </div>
          <p className="text-sm font-medium">{localizeUi("ui.panels.scenariospanel.noScenariosYet")}</p>
          <p className="max-w-[15rem] text-xs text-[var(--muted-foreground)]">{localizeUi("ui.panels.scenariospanel.aScenarioIsAReusableSettingCastAndOpening")}</p>
        </div>
      ) : (
        <>
          {draggedScenarioId && (
            <div
              data-scenario-folder-root
              onDragOver={(event: DragEvent) => event.preventDefault()}
              onDrop={(event: DragEvent) => {
                event.preventDefault();
                const raw = event.dataTransfer.getData("application/x-marinara-scenario-ids");
                let ids: string[] | undefined;
                try {
                  ids = raw ? (JSON.parse(raw) as string[]) : undefined;
                } catch {
                  ids = undefined;
                }
                handleScenarioDrop(null, ids);
              }}
              className="rounded-xl border border-dashed border-[var(--border)] px-3 py-2 text-center text-[0.6875rem] text-[var(--muted-foreground)]"
            >{localizeUi("ui.panels.scenariospanel.dropHereToRemoveFromFolder")}</div>
          )}
          <div className="stagger-children flex flex-col gap-0.5">{rootScenarios.map(renderScenarioRow)}</div>
        </>
      )}

      {scenarioPages.hasNextPage && (
        <PanelLoadMoreBar
          onLoadMore={() => void scenarioPages.fetchNextPage()}
          disabled={scenarioPages.isFetchingNextPage}
        >
          {scenarioPages.isFetchingNextPage ?localizeUi("ui.panels.ttsconfigcard.loading") :localizeUi("ui.gameAssets.assetgrid.loadMore")}
        </PanelLoadMoreBar>
      )}

      {selectionMode && (
        <SelectionActionBar
          placement="panel"
          selectedCount={selectedScenarioIds.size}
          onExport={handleExportSelected}
          onDelete={handleDeleteSelected}
          exporting={exportingSelected}
        />
      )}
    </div>
  );
}

interface ScenarioRowProps {
  scenario: Scenario;
  onClick: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onImagePick: () => void;
  onToggleFavorite: () => void;
  selectionMode: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  draggable: boolean;
  isDragging: boolean;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
}

function ScenarioRow({
  scenario,
  onClick,
  onDelete,
  onDuplicate,
  onImagePick,
  onToggleFavorite,
  selectionMode,
  isSelected,
  onToggleSelect,
  draggable,
  isDragging,
  onDragStart,
  onDragEnd,
  onTouchStart,
}: ScenarioRowProps) {
  const { t: localizeUi } = useUiTranslation();
  const imageClasses =
    "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg mari-panel-gradient-surface mari-panel-gradient--scenarios";
  const imageContent = scenario.imagePath ? (
    <img src={scenario.imagePath} alt="" className="h-full w-full object-cover" />
  ) : (
    <Clapperboard size="0.875rem" />
  );

  const meta = [
    scenario.genre,
    scenario.npcs.length > 0 ? `${scenario.npcs.length} cast` : null,
    scenario.contentRating ? scenario.contentRating.toUpperCase() : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-touch-drag-card="scenario"
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "group relative flex touch-pan-y cursor-pointer items-center gap-3 rounded-xl p-2.5 transition-all hover:bg-[var(--sidebar-accent)]",
        isSelected && "ring-1 ring-[var(--primary)]",
        isDragging && "opacity-50",
      )}
    >
      {selectionMode && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelect();
          }}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
            isSelected ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)]",
          )}
          aria-label={localizeUi("ui.panels.scenariorow.selectScenario")}
        >
          {isSelected && <Check size="0.625rem" className="text-white" />}
        </button>
      )}

      <TouchDragHandle onTouchStart={onTouchStart} />

      {selectionMode ? (
        <div className={imageClasses}>{imageContent}</div>
      ) : (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onImagePick();
          }}
          className={cn(imageClasses, "transition-transform hover:scale-105")}
          title={localizeUi("ui.panels.scenariorow.changeScenarioImage")}
          aria-label={localizeUi("ui.panels.scenariorow.changeScenarioImage")}
        >
          {imageContent}
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            <Camera size="0.875rem" className="text-white" />
          </span>
        </button>
      )}

      <div className={cn("min-w-0 flex-1", !selectionMode && "pr-24")}>
        <div className="flex items-center gap-1.5">
          {scenario.favorite && <Star size="0.6875rem" className="shrink-0 fill-amber-400 text-amber-400" />}
          <span className="truncate text-xs font-medium">{scenario.name}</span>
        </div>
        <p className="truncate text-[0.6875rem] text-[var(--muted-foreground)]">{meta || scenario.description}</p>
      </div>

      {!selectionMode && (
        <div className="absolute right-2 top-1/2 flex shrink-0 -translate-y-1/2 items-center gap-0.5 rounded-lg bg-[var(--sidebar)] px-1 py-0.5 opacity-0 shadow-sm ring-1 ring-[var(--border)] transition-opacity group-hover:opacity-100 max-md:opacity-100">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite();
            }}
            className="mari-chrome-control mari-chrome-control--small p-1.5 active:scale-90"
            title={localizeUi("ui.panels.scenariorow.toggleFavorite")}
            aria-label={localizeUi("ui.panels.scenariorow.toggleFavorite")}
          >
            <Star
              size="0.75rem"
              className={cn(
                scenario.favorite ? "fill-amber-400 text-amber-400" : "text-[var(--muted-foreground)]",
              )}
            />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate();
            }}
            className="mari-chrome-control mari-chrome-control--small p-1.5 active:scale-90"
            title={localizeUi("ui.presets.sectionstab.duplicate")}
            aria-label={localizeUi("ui.presets.sectionstab.duplicate")}
          >
            <Copy size="0.75rem" className="text-[var(--muted-foreground)]" />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
            className="mari-chrome-control mari-chrome-control--small p-1.5 active:scale-90"
            title={localizeUi("lorebook.editor.batch.delete")}
            aria-label={localizeUi("lorebook.editor.batch.delete")}
          >
            <Trash2 size="0.75rem" className="text-[var(--destructive)]" />
          </button>
        </div>
      )}
    </div>
  );
}
