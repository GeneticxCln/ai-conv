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

```bash
docker compose up --build        # ollama + backend + frontend

# in another terminal — the desktop app:
cd frontend && npx electron . --no-sandbox
```

Frontend also available at http://localhost:5173 if you prefer the browser.

## Packaging (installers)

```bash
cd frontend
npm run package        # builds AppImage/deb (linux), nsis (win), dmg (mac)
```

## Tests & Lint

```bash
cd backend  && npm test && npm run lint
cd frontend && npm test && npm run lint
```

## Socket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `user:message` | C → S | `{ conversationId, content, agentChat? }` |
| `generation:stop` | C → S | `conversationId` |
| `agent:token` | S → C | `{ conversationId, messageId, agentId, agentName, token, isDone }` |
| `agent:done` / `agent:error` | S → C | identity + content/error |
| `persona:create/update/delete` | C → S | persona data / id |
| `personas:list` | both | `Persona[]` |
| `models:list` | C → S (ack) | returns installed model names |
| `model:pull` / `model:pull:progress` | C → S / S → C | model name / `{model,status,percent}` |
| `conversation:create/delete/rename` | C → S | title / id / `{id,title}` |
| `conversations:clear` | C → S | — |

## License
MIT

## Architecture

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Frontend   │◄───►│  Backend    │◄───►│   Ollama    │
│  (React)    │ WS  │ (Fastify)   │ HTTP│  (LLM)      │
│  :5173      │     │  :3001      │     │  :11434     │
└─────────────┘     └─────────────┘     └─────────────┘
                           │
                           ▼
                    ┌─────────────┐
                    │   SQLite    │
                    │  (persist)  │
                    └─────────────┘
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- 8GB+ RAM (for llama3.1:8b)

### Run
```bash
# Clone and enter directory
cd AI-conv

# Start all services
# This pulls llama3.1:8b on first run (may take a few minutes)
docker compose up --build
```

### Access
- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3001
- **Ollama API**: http://localhost:11434

## Development

### Without Docker
```bash
# Terminal 1: Start Ollama
ollama serve

# Terminal 2: Backend
cd backend
npm install
npm run dev

# Terminal 3: Frontend
cd frontend
npm install
npm run dev
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
├── config/personas/   # YAML persona definitions
├── docker-compose.yml
└── package.json       # Root workspace
```

## Adding Personas

Create a new YAML file in `config/personas/`:

```yaml
id: "unique-id"
name: "Persona Name"
model: "llama3.1:8b"
systemPrompt: |
  Your system prompt here...
temperature: 0.7
enabled: true
description: "Short description"
avatar: "🎯"
```

Restart backend to load new personas.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://ollama:11434` | Ollama API endpoint |
| `CORS_ORIGIN` | `http://localhost:5173` | Frontend URL for CORS |
| `DATABASE_PATH` | `/data/ai-conv.db` | SQLite file path |
| `PORT` | `3001` | Backend HTTP port |

## Default Models

All personas use `llama3.1:8b` by default. The model-puller service automatically downloads it on first run.

## Socket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `user:message` | Client → Server | `{ conversationId, content }` |
| `agent:token` | Server → Client | `{ conversationId, messageId, agentId, agentName, token, isDone }` |
| `agent:done` | Server → Client | `{ conversationId, messageId, agentId, agentName, fullContent }` |
| `agent:error` | Server → Client | `{ conversationId, agentId, agentName, error }` |
| `agents:list` | Bidirectional | `Persona[]` |
| `agent:toggle` | Client → Server | `agentId` |

## License
MIT
