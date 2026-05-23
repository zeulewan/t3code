import type {
  CommsConversationId,
  CommsConversationSummary,
  CommsMessageWithDelivery,
} from "@t3tools/contracts";
import { MessageCircleIcon, RefreshCcwIcon, UsersIcon } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { getPrimaryEnvironmentConnection } from "../../environments/runtime";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { SidebarGroup } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";

const CONVERSATION_REFRESH_MS = 5_000;
const CONVERSATION_LIMIT = 30;
const MESSAGE_LIMIT = 120;

function formatHandle(handle: string): string {
  return handle.startsWith("@") ? handle : `@${handle}`;
}

function formatConversationTitle(summary: CommsConversationSummary): string {
  if (summary.conversation.title) {
    return summary.conversation.title;
  }

  const handles = summary.participants.map((participant) => formatHandle(participant.handle));
  if (handles.length === 0) {
    return summary.conversation.kind === "dm" ? "Direct message" : "Conversation";
  }

  if (summary.conversation.kind === "dm") {
    return handles.join(" <-> ");
  }

  return handles.join(", ");
}

function formatMessagePreview(summary: CommsConversationSummary): string {
  if (!summary.lastMessage) {
    return "No messages yet";
  }

  const sender = summary.lastSender ? `${formatHandle(summary.lastSender.handle)}: ` : "";
  const body = summary.lastMessage.body.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return `${sender}${body}`.slice(0, 120);
}

function dedupeConversationMessages(
  messages: readonly CommsMessageWithDelivery[],
): CommsMessageWithDelivery[] {
  const byId = new Map<string, CommsMessageWithDelivery>();
  for (const item of messages) {
    if (!byId.has(item.message.messageId)) {
      byId.set(item.message.messageId, item);
    }
  }
  return [...byId.values()].toReversed();
}

export const CommsSidebarSection = memo(function CommsSidebarSection() {
  const [conversations, setConversations] = useState<readonly CommsConversationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<CommsConversationId | null>(
    null,
  );
  const [messages, setMessages] = useState<readonly CommsMessageWithDelivery[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const nextConversations =
        await getPrimaryEnvironmentConnection().client.comms.listConversations({
          limit: CONVERSATION_LIMIT,
        });
      setConversations(nextConversations);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load comms conversations.");
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    void refreshConversations();
    const intervalId = window.setInterval(() => {
      void refreshConversations();
    }, CONVERSATION_REFRESH_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshConversations]);

  const selectedConversation = useMemo(
    () =>
      selectedConversationId
        ? (conversations.find(
            (conversation) => conversation.conversation.conversationId === selectedConversationId,
          ) ?? null)
        : null,
    [conversations, selectedConversationId],
  );

  const refreshMessages = useCallback(async (conversationId: CommsConversationId) => {
    setIsLoadingMessages(true);
    try {
      const nextMessages =
        await getPrimaryEnvironmentConnection().client.comms.listConversationMessages({
          conversationId,
          limit: MESSAGE_LIMIT,
        });
      setMessages(dedupeConversationMessages(nextMessages));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load comms messages.");
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }
    void refreshMessages(selectedConversationId);
  }, [refreshMessages, selectedConversationId]);

  useEffect(() => {
    if (
      selectedConversationId &&
      conversations.length > 0 &&
      !conversations.some(
        (conversation) => conversation.conversation.conversationId === selectedConversationId,
      )
    ) {
      setSelectedConversationId(null);
    }
  }, [conversations, selectedConversationId]);

  return (
    <SidebarGroup className="px-2 pt-2 pb-1">
      <div className="mb-1 flex items-center justify-between pl-2 pr-1.5">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          <MessageCircleIcon className="size-3" />
          Messages
        </span>
        <Button
          type="button"
          size="icon-xs"
          variant="ghost"
          className="size-5 text-muted-foreground/60 hover:text-foreground"
          aria-label="Refresh messages"
          disabled={isLoadingConversations}
          onClick={() => void refreshConversations()}
        >
          {isLoadingConversations ? (
            <Spinner className="size-3" aria-label="Refreshing messages" />
          ) : (
            <RefreshCcwIcon className="size-3" />
          )}
        </Button>
      </div>

      <div className="space-y-1">
        {conversations.length === 0 && !isLoadingConversations ? (
          <p className="px-2 py-2 text-xs text-muted-foreground/45">No comms messages yet.</p>
        ) : null}
        {conversations.slice(0, 6).map((conversation) => {
          const conversationId = conversation.conversation.conversationId;
          const isSelected = selectedConversationId === conversationId;
          return (
            <button
              key={conversationId}
              type="button"
              className={cn(
                "w-full rounded-xl border px-2.5 py-2 text-left transition-colors",
                isSelected
                  ? "border-primary/30 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground/80 hover:bg-accent/70 hover:text-foreground",
              )}
              onClick={() => {
                setSelectedConversationId((current) =>
                  current === conversationId ? null : conversationId,
                );
              }}
            >
              <span className="flex min-w-0 items-center gap-2">
                {conversation.conversation.kind === "group" ? (
                  <UsersIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                ) : (
                  <MessageCircleIcon className="size-3.5 shrink-0 text-muted-foreground/60" />
                )}
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {formatConversationTitle(conversation)}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground/45">
                  {formatRelativeTimeLabel(conversation.updatedAt)}
                </span>
              </span>
              <span className="mt-1 block truncate text-[11px] text-muted-foreground/55">
                {formatMessagePreview(conversation)}
              </span>
            </button>
          );
        })}
      </div>

      {selectedConversation ? (
        <div className="mt-2 rounded-2xl border border-border/70 bg-card/45 p-2 shadow-sm">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-medium text-foreground">
              {formatConversationTitle(selectedConversation)}
            </p>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="size-5 text-muted-foreground/60"
              aria-label="Refresh conversation"
              disabled={isLoadingMessages}
              onClick={() => void refreshMessages(selectedConversation.conversation.conversationId)}
            >
              {isLoadingMessages ? (
                <Spinner className="size-3" aria-label="Loading conversation" />
              ) : (
                <RefreshCcwIcon className="size-3" />
              )}
            </Button>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {messages.map((item) => (
              <div key={item.message.messageId} className="rounded-xl bg-background/60 px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/60">
                    {formatHandle(item.sender.handle)}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground/40">
                    {formatRelativeTimeLabel(item.message.createdAt)}
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground/90">
                  {item.message.body}
                </p>
              </div>
            ))}
            {messages.length === 0 && !isLoadingMessages ? (
              <p className="px-1 py-2 text-xs text-muted-foreground/45">No messages loaded.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 px-2 text-[11px] text-destructive/80">{error}</p> : null}
    </SidebarGroup>
  );
});
