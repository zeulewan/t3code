import {
  type EnvironmentId,
  type ChatHeaderVisibilitySettings,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadIdentity,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime";
import { memo, useCallback, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { DiffIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../environments/primary";
import { ThreadIdentityAvatar } from "../ThreadIdentityAvatar";
import { ThreadIdentityPickerDialog } from "../ThreadIdentityPickerDialog";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeThreadIdentity?: ThreadIdentity;
  agentIdentityModeEnabled?: boolean;
  activeThreadBranch: string | null;
  activeThreadWorktreePath: string | null;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  visibility: ChatHeaderVisibilitySettings;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onThreadIdentityChange?: (identity: ThreadIdentity) => Promise<void> | void;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeThreadIdentity,
  agentIdentityModeEnabled = false,
  activeThreadBranch,
  activeThreadWorktreePath,
  activeProjectName,
  isGitRepo,
  visibility,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onThreadIdentityChange,
  onToggleTerminal,
  onToggleDiff,
}: ChatHeaderProps) {
  const [identityPickerOpen, setIdentityPickerOpen] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  const branchBadgeLabel = activeThreadBranch
    ? `${activeThreadBranch}${activeThreadWorktreePath ? " (worktree)" : ""}`
    : null;
  const showThreadIdentity =
    agentIdentityModeEnabled &&
    activeThreadIdentity !== undefined &&
    onThreadIdentityChange !== undefined;
  const handleThreadIdentitySelect = useCallback(
    (identity: ThreadIdentity) => onThreadIdentityChange?.(identity),
    [onThreadIdentityChange],
  );

  return (
    <>
      <div className="@container/header-actions flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 overflow-hidden sm:flex-1 sm:flex-nowrap sm:gap-3">
          <SidebarTrigger className="size-7 shrink-0 md:hidden" />
          {showThreadIdentity && activeThreadIdentity ? (
            <ThreadIdentityAvatar
              identity={activeThreadIdentity}
              size="md"
              onClick={() => setIdentityPickerOpen(true)}
            />
          ) : null}
          <h2
            className="min-w-0 flex-1 basis-40 truncate text-sm font-medium text-foreground"
            title={activeThreadTitle}
          >
            {activeThreadTitle}
          </h2>
          {visibility.projectBadge && activeProjectName && (
            <Badge
              variant="outline"
              className="min-w-0 max-w-full shrink overflow-hidden sm:max-w-56"
            >
              <span className="min-w-0 truncate">{activeProjectName}</span>
            </Badge>
          )}
          {visibility.branchBadge && branchBadgeLabel && (
            <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
              <span className="min-w-0 truncate font-mono">{branchBadgeLabel}</span>
            </Badge>
          )}
          {visibility.noGitBadge && activeProjectName && !isGitRepo && (
            <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
              No Git
            </Badge>
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-start gap-2 sm:shrink-0 sm:justify-end @3xl/header-actions:gap-3">
          {visibility.projectScripts && activeProjectScripts && (
            <ProjectScriptsControl
              scripts={activeProjectScripts}
              keybindings={keybindings}
              preferredScriptId={preferredScriptId}
              onRunScript={onRunProjectScript}
              onAddScript={onAddProjectScript}
              onUpdateScript={onUpdateProjectScript}
              onDeleteScript={onDeleteProjectScript}
            />
          )}
          {visibility.openInPicker && showOpenInPicker && (
            <div className="hidden sm:block">
              <OpenInPicker
                keybindings={keybindings}
                availableEditors={availableEditors}
                openInCwd={openInCwd}
              />
            </div>
          )}
          {visibility.gitActions && activeProjectName && (
            <GitActionsControl
              gitCwd={gitCwd}
              activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
              {...(draftId ? { draftId } : {})}
            />
          )}
          {visibility.terminalToggle && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={terminalOpen}
                    onPressedChange={onToggleTerminal}
                    aria-label="Toggle terminal drawer"
                    variant="outline"
                    size="xs"
                    disabled={!terminalAvailable}
                  >
                    <TerminalSquareIcon className="size-3" />
                  </Toggle>
                }
              />
              <TooltipPopup side="bottom">
                {!terminalAvailable
                  ? "Terminal is unavailable until this thread has an active project."
                  : terminalToggleShortcutLabel
                    ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
                    : "Toggle terminal drawer"}
              </TooltipPopup>
            </Tooltip>
          )}
          {visibility.diffToggle && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Toggle
                    className="shrink-0"
                    pressed={diffOpen}
                    onPressedChange={onToggleDiff}
                    aria-label="Toggle diff panel"
                    variant="outline"
                    size="xs"
                    disabled={!isGitRepo && !diffOpen}
                  >
                    <DiffIcon className="size-3" />
                  </Toggle>
                }
              />
              <TooltipPopup side="bottom">
                {!isGitRepo && !diffOpen
                  ? "Diff panel is unavailable because this project is not a git repository."
                  : diffToggleShortcutLabel
                    ? `Toggle diff panel (${diffToggleShortcutLabel})`
                    : "Toggle diff panel"}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
      </div>
      {showThreadIdentity ? (
        <ThreadIdentityPickerDialog
          open={identityPickerOpen}
          value={activeThreadIdentity ?? null}
          onOpenChange={setIdentityPickerOpen}
          onSelect={handleThreadIdentitySelect}
        />
      ) : null}
    </>
  );
});
