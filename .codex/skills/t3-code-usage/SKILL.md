---
name: t3-code-usage
description: Use this skill when working with T3 Code as a running tool, including T3 CLI commands, browser connection and pairing, agent spawning/sending, and inter-agent comms. This skill is for usage and operations only; do not use it as a repository development guide.
---

# T3 Code Usage

Use this skill for operating T3 Code, its CLI, local agents, and inter-agent comms. Do not treat it as a development workflow skill; repo coding rules and implementation guidance belong in a separate future skill.

## Command Entry Point

From the repo root, use the source CLI unless the installed `t3` binary is explicitly preferred:

```sh
node apps/server/src/bin.ts --log-level error <command>
```

For this local workspace, most commands should include:

```sh
--base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Full pattern:

```sh
node apps/server/src/bin.ts --log-level error <command> --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

## Browser Connection

The normal browser URL can be a thread deep link like:

```text
https://workstation.tailee9084.ts.net:13773/<environment-id>/<thread-id>
```

If unauthenticated, T3 should redirect to `/pair`. Pair once with a one-time token or pairing link; after the browser receives the `t3_session` cookie, deep links are the right way to open specific threads.

Useful checks:

```sh
curl -i -sS https://workstation.tailee9084.ts.net:13773/api/auth/session
curl -i -sS https://workstation.tailee9084.ts.net:13773/.well-known/t3/environment
```

If reconnect logs show repeated `Invalid session token signature`, the browser is carrying a stale `t3_session` cookie. A healthy server should clear that cookie from `/api/auth/session` and then require pairing again.

## Agent CLI

List agents:

```sh
node apps/server/src/bin.ts --log-level error agent list --project t3code --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Send to an existing agent by thread id, title, or comms handle:

```sh
node apps/server/src/bin.ts --log-level error agent send <thread-or-handle> '<message>' --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Attach one or more provider-safe images to an agent message:

```sh
node apps/server/src/bin.ts --log-level error agent send <thread-or-handle> '<message>' --attach /path/to/image.png --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

`agent send --attach` currently supports GIF, JPEG, PNG, and WebP images. Generic non-image files are not supported by this CLI/schema path yet.

Spawned agents are seeded with comms instructions. Custom handles are not the main path; rename/register through the supported CLI flow when needed.

## Comms CLI

Comms handles are written without `@` in commands. Examples: `joe`, `bob`, `river`.

List active comms actors:

```sh
node apps/server/src/bin.ts --log-level error comms actors --project t3code --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Register or update an actor:

```sh
node apps/server/src/bin.ts --log-level error comms register <handle> --kind agent --thread <thread-id> --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Send a direct interruptive message:

```sh
node apps/server/src/bin.ts --log-level error comms send <from-handle> <target-handle> '<message>' --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733 --type direct
```

Read inbox:

```sh
node apps/server/src/bin.ts --log-level error comms inbox <handle> --base-dir /home/zeul/.t3 --dev-url http://workstation.tailee9084.ts.net:5733
```

Delivery types:

- `direct`: stores the message and injects the full message into the recipient thread when a live server and thread binding exist.
- `notify`: stores the message and injects only an inbox notification into the recipient thread.
- `defer`: stores inbox mail only; no live runtime injection.
- `--no-deliver`: stores the message without runtime injection.

Use `defer` when the target runtime is broken or should not be interrupted.

## Agent Comms Behavior

When asked to message another agent, run the comms CLI. Do not merely draft the message or say you cannot message them if the CLI is available.

When receiving a T3 comms direct message that asks for a reply, confirmation, continuation, or answer, reply to the sender through comms. Keep the actual conversation in the comms message body. Local thread replies after a successful send should be quiet, usually `sent`, unless the human asked for status.

Write comms messages in first person as yourself. Do not refer to yourself by handle except inside CLI commands or when giving your address.

## Troubleshooting Comms

If direct delivery fails with `requires a running T3 server`, either start/restart T3 or use `--type defer` to write inbox-only mail.

If sending fails because an actor has a missing, deleted, archived, or inactive backing thread, re-register the handle to a healthy active thread before using `direct` or `notify`.

If a recipient is not responding but delivery says it succeeded, inspect provider logs for runtime errors. Comms delivery and model runtime health are separate.

## Log Reading

Useful log locations:

```text
/home/zeul/.t3/dev/logs/server-restart.log
/home/zeul/.t3/dev/logs/server.trace.ndjson
/home/zeul/.t3/dev/logs/provider/
/home/zeul/.t3/userdata/logs/
```

For websocket logs, `/ws 204` usually means a websocket closed cleanly. `/ws 401` points to auth. `/ws 503` during restart often means an old socket fiber was interrupted. Check duration and surrounding restart lines before treating it as network instability.
