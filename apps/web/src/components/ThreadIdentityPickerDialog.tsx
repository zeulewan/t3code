import { CheckIcon } from "lucide-react";
import type { ThreadIdentity } from "@t3tools/contracts";
import { THREAD_IDENTITY_PRESETS } from "@t3tools/shared/threadIdentity";
import { cn } from "~/lib/utils";
import { ThreadIdentityAvatar } from "./ThreadIdentityAvatar";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

export function ThreadIdentityPickerDialog({
  open,
  value,
  title = "Change icon/color",
  onOpenChange,
  onSelect,
}: {
  readonly open: boolean;
  readonly value: ThreadIdentity | null;
  readonly title?: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (identity: ThreadIdentity) => Promise<void> | void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose the agent identity shown for this thread.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {THREAD_IDENTITY_PRESETS.map((identity) => {
              const selected = value?.preset === identity.preset;
              return (
                <button
                  key={identity.preset}
                  type="button"
                  className={cn(
                    "flex min-h-16 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
                    selected && "border-primary bg-primary/5",
                  )}
                  onClick={() => {
                    void Promise.resolve(onSelect(identity)).then(() => onOpenChange(false));
                  }}
                >
                  <ThreadIdentityAvatar identity={identity} size="md" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {identity.name}
                  </span>
                  {selected ? (
                    <CheckIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
