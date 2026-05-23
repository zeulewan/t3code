import {
  DEFAULT_THREAD_IDENTITY,
  type ProjectId,
  type ThreadIdentity,
  type ThreadIdentityPreset,
} from "@t3tools/contracts";

export const THREAD_IDENTITY_PRESETS = [
  { preset: "af_sky", name: "Sky", icon: "cloud", color: "#3A86FF" },
  { preset: "af_alloy", name: "Alloy", icon: "diamond", color: "#E67E22" },
  { preset: "af_sarah", name: "Sarah", icon: "heart", color: "#E63946" },
  { preset: "am_adam", name: "Adam", icon: "leaf", color: "#2ECC71" },
  { preset: "am_echo", name: "Echo", icon: "waveform", color: "#9B59B6" },
  { preset: "am_onyx", name: "Onyx", icon: "shield", color: "#7F8C8D" },
  { preset: "bm_fable", name: "Fable", icon: "book", color: "#F1C40F" },
] as const satisfies ReadonlyArray<ThreadIdentity>;

const PRESETS_BY_ID = new Map<ThreadIdentityPreset, ThreadIdentity>(
  THREAD_IDENTITY_PRESETS.map((preset) => [preset.preset, preset]),
);

export function getThreadIdentityPreset(preset: ThreadIdentityPreset): ThreadIdentity {
  return PRESETS_BY_ID.get(preset) ?? DEFAULT_THREAD_IDENTITY;
}

export function normalizeThreadIdentity(
  identity: ThreadIdentity | null | undefined,
): ThreadIdentity {
  return identity ? getThreadIdentityPreset(identity.preset) : DEFAULT_THREAD_IDENTITY;
}

export interface ThreadIdentityAssignmentCandidate {
  readonly projectId: ProjectId;
  readonly deletedAt?: string | null | undefined;
  readonly identity?: ThreadIdentity | null | undefined;
}

export function chooseNextThreadIdentity(
  projectId: ProjectId,
  threads: ReadonlyArray<ThreadIdentityAssignmentCandidate>,
): ThreadIdentity {
  const counts = new Map<ThreadIdentityPreset, number>(
    THREAD_IDENTITY_PRESETS.map((preset) => [preset.preset, 0]),
  );

  for (const thread of threads) {
    if (thread.projectId !== projectId || thread.deletedAt != null) {
      continue;
    }
    const identity = normalizeThreadIdentity(thread.identity);
    counts.set(identity.preset, (counts.get(identity.preset) ?? 0) + 1);
  }

  let selected: ThreadIdentity = THREAD_IDENTITY_PRESETS[0]!;
  let selectedCount = counts.get(selected.preset) ?? 0;
  for (const preset of THREAD_IDENTITY_PRESETS.slice(1)) {
    const count = counts.get(preset.preset) ?? 0;
    if (count < selectedCount) {
      selected = preset;
      selectedCount = count;
    }
  }
  return selected;
}

export function countProjectThreadsUsingIdentity(input: {
  readonly projectId: ProjectId;
  readonly identity: ThreadIdentity;
  readonly threads: ReadonlyArray<ThreadIdentityAssignmentCandidate>;
}): number {
  return input.threads.filter(
    (thread) =>
      thread.projectId === input.projectId &&
      thread.deletedAt == null &&
      normalizeThreadIdentity(thread.identity).preset === input.identity.preset,
  ).length;
}

export function buildAgentThreadTitle(input: {
  readonly identity: ThreadIdentity;
  readonly existingSamePresetCount: number;
}): string {
  const normalized = normalizeThreadIdentity(input.identity);
  return input.existingSamePresetCount > 0
    ? `${normalized.name} ${input.existingSamePresetCount + 1}`
    : normalized.name;
}
