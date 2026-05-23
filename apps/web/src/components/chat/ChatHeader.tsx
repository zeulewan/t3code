import {
  type ChatHeaderVisibilitySettings,
  type EditorId,
  type EnvironmentId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadIdentity,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { memo, useCallback, useState } from "react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { cn } from "~/lib/utils";
import { ThreadIdentityAvatar } from "../ThreadIdentityAvatar";
import { ThreadIdentityPickerDialog } from "../ThreadIdentityPickerDialog";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeThreadIdentity?: ThreadIdentity;
  agentIdentityModeEnabled?: boolean;
  activeProjectName: string | undefined;
  visibility: ChatHeaderVisibilitySettings;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  onThreadIdentityChange?: (identity: ThreadIdentity) => Promise<void> | void;
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
  activeProjectName,
  visibility,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  gitCwd,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onThreadIdentityChange,
}: ChatHeaderProps) {
  const [identityPickerOpen, setIdentityPickerOpen] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
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
      <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
          {showThreadIdentity && activeThreadIdentity ? (
            <ThreadIdentityAvatar
              identity={activeThreadIdentity}
              size="sm"
              onClick={() => setIdentityPickerOpen(true)}
            />
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <h2
                  aria-label={activeThreadTitle}
                  className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
                >
                  {activeThreadTitle}
                </h2>
              }
            />
            <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
          </Tooltip>
        </div>
        <div
          data-chat-header-actions
          className={cn(
            "flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3",
            rightPanelOpen ? "pr-0" : "pr-16",
          )}
        >
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
            <OpenInPicker
              environmentId={activeThreadEnvironmentId}
              keybindings={keybindings}
              availableEditors={availableEditors}
              openInCwd={openInCwd}
            />
          )}
          {visibility.gitActions && activeProjectName && (
            <GitActionsControl
              gitCwd={gitCwd}
              activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
              {...(draftId ? { draftId } : {})}
            />
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
