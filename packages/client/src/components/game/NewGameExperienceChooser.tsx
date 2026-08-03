// Installed game EXPERIENCES, offered as one block inside the setup wizard's first step. They are
// discovered from their manifest (the `game-surface` slot), so no package is named here. Activating one
// swaps the wizard BODY for that package's own setup; the choice travels in the setup config.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Gamepad2, Sparkles, X } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  NEUTRAL_PANEL_CLOSE_BUTTON,
  NEUTRAL_PANEL_CLOSE_ICON_SIZE,
  NEUTRAL_PANEL_HEADER,
  NEUTRAL_PANEL_SHELL,
  NEUTRAL_PANEL_TITLE,
} from "../ui/neutral-surface-styles";
import { CapabilityElement } from "../capabilities/CapabilityElement";
import { useCreateGame, useGameSetup } from "../../hooks/use-game";
import { useInstalledCapabilityPackages } from "../../hooks/use-capability-packages";
import { characterKeys } from "../../hooks/use-characters";
import { lorebookKeys } from "../../hooks/use-lorebooks";
import { useUIStore } from "../../stores/ui.store";
import { useTranslation as useUiTranslation } from "react-i18next";

type InstalledPkg = {
  id: string;
  status: string;
  manifest: { name: string; description: string; contributions?: { slots?: string[] } };
};

// Same treatment the wizard gives its own "import setup" button, so the block reads as part of the step.
const SECONDARY_BUTTON =
  "flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--secondary)] px-3 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/40 disabled:cursor-wait disabled:opacity-50";

export function NewGameExperienceChooser({
  activeChatId,
  onCancelSetup,
  renderClassicWizard,
}: {
  activeChatId: string;
  /** Same dismissal the built-in wizard uses, so closing an experience's setup behaves identically. */
  onCancelSetup: () => void;
  /** Renders the built-in wizard with our block injected into its first step. */
  renderClassicWizard: (experiencesSlot: ReactNode) => ReactNode;
}) {
  const { t: localizeUi } = useUiTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  /** The activated experience. null = the built-in wizard is showing. */
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: installed = [] } = useInstalledCapabilityPackages(true);
  const createGame = useCreateGame();
  const gameSetup = useGameSetup();
  const openAgentCatalog = useUIStore((s) => s.openAgentCatalog);

  // The same signal GameSurface mounts on, so this list can never offer something that wouldn't render.
  const experiences = useMemo(
    () =>
      (installed as InstalledPkg[]).filter(
        (p) => p.status === "active" && p.manifest.contributions?.slots?.includes("game-surface"),
      ),
    [installed],
  );
  const activeExperience = experiences.find((e) => e.id === activeId) ?? null;
  // Freezes every control that could tear down the run mid-launch: flipping the experience off here
  // would create a game under one mode and set it up as another. The wizard's `isLoading` equivalent.
  const launching = createGame.isPending || gameSetup.isPending;

  // Escape closes the package's setup, matching the backdrop click and the wizard this panel replaces.
  useEffect(() => {
    if (!activeId || launching) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelSetup();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, launching, onCancelSetup]);

  // The package prepares the config; the host creates the game and runs the opening, since it owns
  // navigation and the query cache. The experience must supply the connection — guessing one here would
  // duplicate the eligibility rules that live in the setup wizard.
  const onLaunch = useCallback(
    async (
      setupConfig: unknown,
      gameName: string,
      _config?: unknown,
      connections?: { gmConnectionId?: string | null },
    ) => {
      const connectionId = connections?.gmConnectionId;
      if (!connectionId) throw new Error("The experience must provide a gmConnectionId to launch a game");
      const cfg = setupConfig as { promptPresetId?: string };
      // Stamps which experience owns this game; /game/create copies it to the chat metadata.
      const res = await createGame.mutateAsync({
        name: gameName,
        setupConfig: { ...(setupConfig as Record<string, unknown>), gameExperienceId: activeId } as unknown,
        preferences: "",
        chatId: activeChatId,
        connectionId,
        promptPresetId: cfg.promptPresetId ?? undefined,
      } as Parameters<typeof createGame.mutateAsync>[0]);
      const chatId = res.sessionChat.id;
      await gameSetup.mutateAsync({
        chatId,
        connectionId,
        preferences: "",
        promptPresetId: cfg.promptPresetId ?? null,
      } as Parameters<typeof gameSetup.mutateAsync>[0]);
      // A setup may have written host resources straight to storage, which nothing on this side knows
      // about. `lorebookKeys.all` rather than `.list()`: the lists are also cached per category.
      queryClient.invalidateQueries({ queryKey: characterKeys.personas });
      queryClient.invalidateQueries({ queryKey: lorebookKeys.all });
      // An experience that keeps its own state needs the chat id to seed itself.
      return chatId;
    },
    [activeChatId, activeId, createGame, gameSetup, queryClient],
  );

  const experiencesSlot = (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--primary)]" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--foreground)]">{localizeUi("ui.game.newgameexperiencechooser.experiences")}</p>
            <p className="mt-0.5 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">
              {activeExperience
                ?localizeUi("ui.game.newgameexperiencechooser.value1WillRunThisGameTurnItOffTo", { value1: activeExperience.manifest.name })
                :localizeUi("ui.game.newgameexperiencechooser.runThisGameWithADownloadedExperienceInsteadOf")}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={launching}
          className={SECONDARY_BUTTON}
        >
          <Sparkles size={13} />
          {open ?localizeUi("ui.noodle.stageprofileview.hide") :localizeUi("ui.chat.hiddenfromaimessagesummary.show")}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
          {experiences.length > 0 ? (
            experiences.map((exp) => {
              const isActive = exp.id === activeId;
              return (
                // Same row+switch the host uses for its own on/off options ("customize parameters").
                <button
                  key={exp.id}
                  type="button"
                  role="switch"
                  aria-checked={isActive}
                  disabled={launching}
                  onClick={() => setActiveId(isActive ? null : exp.id)}
                  className="flex w-full items-center justify-between gap-3 text-left disabled:cursor-wait disabled:opacity-50"
                >
                  <div className="min-w-0">
                    <span className="block text-xs font-medium text-[var(--foreground)]">{exp.manifest.name}</span>
                    <span className="line-clamp-2 block text-[0.575rem] leading-relaxed text-[var(--muted-foreground)]">
                      {exp.manifest.description}
                    </span>
                  </div>
                  <div
                    className={cn(
                      "h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors",
                      isActive ? "bg-[var(--primary)]" : "bg-[var(--muted-foreground)]/50",
                    )}
                  >
                    <div
                      className={cn(
                        "h-4 w-4 rounded-full bg-white transition-transform",
                        isActive && "translate-x-3.5",
                      )}
                    />
                  </div>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-[0.625rem] leading-relaxed text-[var(--muted-foreground)]">{localizeUi("ui.game.newgameexperiencechooser.noExperiencesDownloadedYet")}</p>
              <button
                type="button"
                onClick={openAgentCatalog}
                disabled={launching}
                className={SECONDARY_BUTTON}
              >
                <Gamepad2 size={13} />{localizeUi("ui.agents.agentcatalogview.downloadAgents")}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (!activeId) return <>{renderClassicWizard(experiencesSlot)}</>;

  // Activated → the package draws the wizard body inside the same shell the built-in one uses, with the
  // block kept above it so the player can switch back.
  return (
    <>
      <div
        className="fixed inset-0 z-[10000] bg-black/45 backdrop-blur-[2px]"
        onClick={launching ? undefined : onCancelSetup}
      />
      <div className="fixed inset-0 z-[10001] flex items-center justify-center p-3 pointer-events-none max-md:pt-[max(0.75rem,env(safe-area-inset-top))] max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
        {/* NEUTRAL_PANEL_SHELL remaps the theme tokens to the chrome palette inside the panel, the same
            way the built-in wizard does. Without it the package's setup comes out tinted. */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="game-experience-setup-title"
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={cn(
            NEUTRAL_PANEL_SHELL,
            "pointer-events-auto flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden sm:max-h-[min(90dvh,44rem)]",
          )}
        >
          <div className={cn(NEUTRAL_PANEL_HEADER, "flex shrink-0 items-center justify-between")}>
            <h3 id="game-experience-setup-title" className={NEUTRAL_PANEL_TITLE}>
              {activeExperience?.manifest.name ?? "New Game"}
            </h3>
            <button
              type="button"
              onClick={onCancelSetup}
              disabled={launching}
              className={cn(NEUTRAL_PANEL_CLOSE_BUTTON, "disabled:cursor-wait disabled:opacity-40")}
              aria-label={localizeUi("ui.game.gamesetupwizard.closeSetup")}
            >
              <X size={NEUTRAL_PANEL_CLOSE_ICON_SIZE} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <div className="mb-4">{experiencesSlot}</div>
            <CapabilityElement
              packageId={activeId}
              view="setup"
              capabilityProps={{
                chatId: activeChatId,
                onLaunch,
                onCancel: () => setActiveId(null),
              }}
            />
          </div>
        </motion.div>
      </div>
    </>
  );
}
