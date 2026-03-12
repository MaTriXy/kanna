# Kanna

Local-only project chat UI for Claude-powered coding workflows.

Point it at a folder, open the app locally, and work in multiple persistent chats tied to that project. No auth. No cloud sync. No hosted database.

## Features

- Project-first sidebar with multiple chats per project
- Local projects page (auto-discovers from `~/.claude/projects`)
- Transcript rendering with plan mode / full access mode
- Persistent local history, refresh-safe chat routes

## Requirements

- [Bun](https://bun.sh)
- A working Claude Agent SDK environment

## Install

```bash
bun install
```

## Run

```bash
bun run build
bun run start
```

Or use the CLI directly:

```bash
kanna
```

Flags:

```bash
bun run start -- --no-open
bun run start -- --port 4000
```

Default URL: `http://localhost:3210`

## Development

```bash
bun run dev
```

Or run client and server separately:

```bash
bun run dev:client   # http://localhost:5174
bun run dev:server   # http://localhost:3211
```

## Scripts

| Command | Description |
|---|---|
| `bun run build` | Build for production |
| `bun run check` | Typecheck + build |
| `bun run dev` | Run client + server together |
| `bun run dev:client` | Vite dev server only |
| `bun run dev:server` | Bun backend only |
| `bun run start` | Start production server |

## Project Structure

- `src/client/` — React UI
- `src/server/` — Bun server, WebSocket routing, local persistence, Claude project discovery
- `src/shared/` — Shared protocol and view-model types

## Data

State is stored locally at `~/.kanna/data/`:

- `projects.jsonl`
- `chats.jsonl`
- `messages.jsonl`
- `turns.jsonl`
- `snapshot.json`
