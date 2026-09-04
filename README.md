# AI Conv - Multi-Persona Messenger

A real-time desktop (Electron) messenger where **you create your own AI personas** — powered by local LLMs via Ollama. No hard-coded personas, no hard-coded models.

## Features

- 🧑‍🎨 **Your own personas** — create/edit/delete in the app: name, emoji avatar, personality prompt, creativity slider
- 📦 **Model picker** — dropdown lists exactly what's downloaded in Ollama; pull new models from Settings with live progress
- ⚡ Real-time token streaming, stop-generation button
- 💬 Markdown rendering (code blocks, tables, lists), copy message
- 🗂 Conversations: auto-titled from first message, rename (double-click), delete, export as Markdown
- 🌗 Dark mode + full settings panel (server status, clear data)
- 🤝 Optional agent-to-agent round: personas react to each other's answers
- 🎯 `@Name` targeting — ask one persona directly
- 💾 SQLite persistence (Docker named volume)
- 🖥 Electron desktop window

## Quick Start

### Prerequisites
- Docker & Docker Compose
- 8GB+ RAM recommended (model-dependent)

```bash
# Clone and enter directory
cd AI-conv

# Generate JWT_SECRET in .env (idempotent, safe to re-run)
node scripts/generate-jwt-secret.mjs

# Start all services (pulls llama3.1:8b on first run — may take a few minutes)
docker compose up --build

# In another terminal — the desktop app:
cd frontend && npx electron . --no-sandbox
```

### Access
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **Ollama API**: http://localhost:11434

## Packaging (installers)

```bash
cd frontend
npm run package        # builds the configured Linux unpacked app (see electron-builder targets)
```

## Tests & Lint

```bash
npm test --workspace=backend
npm test --workspace=frontend
npm run build --workspaces
npm run lint --workspaces
npm run test:e2e --workspace=frontend
```

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │◄───►│  Backend    │◄───►│   Ollama    │
│  (React)    │ WS  │ (Fastify)   │ HTTP│  (LLM)      │
│  :5173      │:3001│  :3001      │     │  :11434     │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   SQLite    │
                    │  (persist)  │
                    └─────────────┘
```

## Development

### Without Docker
```bash
# Terminal 1: Start Ollama
ollama serve

# Install all workspaces once from the repository root
npm ci

# Terminal 2: Backend
npm run dev:backend

# Terminal 3: Frontend
npm run dev:frontend
```

### Project Structure
```
AI-conv/
├── backend/           # Fastify + Socket.io
│   ├── src/
│   │   ├── agents/    # Agent personas & logic
│   │   ├── llm/       # Ollama client
│   │   ├── storage/   # SQLite
│   │   └── ws/        # WebSocket handlers
├── frontend/          # React + Vite
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── stores/
├── config/personas/   # (legacy) YAML persona definitions
├── docker-compose.yml
└── package.json       # Root workspace
```

## Personas

Personas are created and managed via the UI (Personas sidebar). They are stored in the SQLite database, not loaded from YAML files.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://ollama:11434` | Ollama API endpoint |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend URL for CORS |
| `DATABASE_PATH` | `/data/ai-conv.db` | SQLite file path |
| `PORT` | `3001` | Backend HTTP port |
| `JWT_SECRET` | *(required in production)* | Generate with `npm run setup`; keep stable across restarts |

## Default Models

No model is hard-coded. The backend auto-detects the first model installed in Ollama when creating a persona, and the model picker lists every model you have downloaded. The Docker `model-puller` service pre-downloads `llama3.1:8b` so the stack works out of the box — you can pull any other model from the app's Settings → Models tab.

## Browser E2E

The Playwright suite starts both Vite and the backend. It creates a disposable local profile through `user:create`, stores the issued token in test-only browser storage, and uses `http://localhost:3001` for Socket.IO.

```bash
npm run test:e2e --workspace=frontend
```

## Socket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `user:message` | Client → Server | `{ conversationId, content, agentChat?, tempId? }` |
| `generation:stop` | Client → Server | `conversationId` |
| `agent:token` | Server → Client | `{ conversationId, messageId, agentId, agentName, token, isDone }` |
| `agent:done` | Server → Client | `{ conversationId, messageId, agentId, agentName, fullContent }` |
| `agent:error` | Server → Client | `{ conversationId, agentId, agentName, error }` |
| `personas:list` | Bidirectional | `Persona[]` |
| `persona:create/update/delete` | Client → Server | persona data / id |
| `models:list` | Client → Server (ack) | returns installed model names |
| `model:pull` / `model:pull:progress` | Client → Server / Server → Client | model name / `{model, status, percent}` |
| `conversation:create/delete/rename` | Client → Server | title / id / `{id, title}` |
| `conversations:clear` | Client → Server | — |
| `message:delete` | Client → Server | message id |
| `message:regenerate` | Client → Server | message id |
| `join` | Client → Server | Authenticated conversation join; returns the first message page |
| `messages:older` | Client → Server (ack) | `{ conversationId, before }` |
| `conversation:import` | Client → Server (ack) | `{ title, messages }` |

## License
MIT
