# Codex Thread Title and CWD Plan

Goal: make T3 thread titles and Codex thread names converge, and make imported Codex sessions attach to the correct T3 project cwd.

Current implementation checklist:

1. Add provider-level `setThreadTitle` plumbing.
2. Implement Codex `thread/name/set` in the Codex runtime and adapter.
3. Treat non-Codex providers as no-op for provider-side thread titles.
4. On T3 `thread.meta-updated`, push the title to Codex when the active session is Codex.
5. Avoid title echo loops by ignoring Codex name updates that already match the T3 title.
6. During Codex import, read the target T3 project cwd. If the source Codex thread cwd differs, call `thread/fork` into the target cwd and resume the fork.
7. Pass the T3 title into provider session startup so Codex starts/resumes with the same name.
8. Validate with `bun fmt`, `bun lint`, and `bun typecheck`.

Related Codex app-server RPCs:

- `thread/name/set`
- `thread/fork`
- `thread/resume`
