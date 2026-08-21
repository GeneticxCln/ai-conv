# Phase One Plan: AI Conv - Multi-Agent Messenger

## Goal
Build a working multi-agent messenger with local LLMs (Ollama) using Node.js/TypeScript, Docker Compose, WebSocket real-time communication, and a React frontend.

---

## Scope (Phase 1)

### Backend
- [ ] Fastify + Socket.io server with TypeScript
- [ ] WebSocket connection management (join, leave, reconnect)
- [ ] Ollama streaming client (async generators)
- [ ] Agent registry: load personas from YAML, instantiate agents
- [ ] BaseAgent class with `streamResponse(message)` method
- [ ] SQLite storage: conversations, messages, agent metadata
- [ ] Socket events: `user:message`, `agent:token`, `agent:done`, `agent:error`
  - **All `agent:token` events must include `agentId` and `agentName` in payload** for frontend routing
- [ ] Explicit CORS config: allow `http://localhost:5173` (Fastify + Socket.io)
- [ ] Health check endpoint

### Frontend
- [ ] React 18 + Vite + TypeScript
- [ ] Tailwind CSS + shadcn/ui components
- [ ] Socket.io client connection with auto-reconnect
- [ ] Chat UI: message list, input bar, streaming indicator
- [ ] Persona sidebar: list agents, toggle enable/disable
- [ ] Zustand store for messages, agents, connection state
- [ ] Message bubbles with role styling (user, agent, system)

### Personas (config/personas/)
- [ ] `coder.yaml` - Senior developer (**llama3.1:8b**)
- [ ] `reviewer.yaml` - Code reviewer (**llama3.1:8b**)
- [ ] `creative.yaml` - Creative writer (**llama3.1:8b**)
- [ ] `analyst.yaml` - Analytical thinker (**llama3.1:8b**)
- **Default model for all personas: `llama3.1:8b`** — no other model tags

### Docker
- [ ] `backend/Dockerfile` (Node 20, dev with hot reload)
- [ ] `frontend/Dockerfile` (Node 20, Vite dev server)
- [ ] `docker-compose.yml` with 3 services: ollama, backend, frontend
- [ ] **Named Docker volume for SQLite** (`.db` file persists across `docker compose down`)
- [ ] Ollama volume for model persistence
- [ ] **Ollama model pull entrypoint script** — pulls required models on first boot before backend starts
- [ ] Health checks and depends_on (backend depends on ollama healthy)

### Dev Experience
- [ ] Root package.json with workspaces
- [ ] Shared TypeScript types (Zod schemas)
- [ ] ESLint + Prettier configs
- [ ] README with run instructions

---

## Out of Scope (Phase 2+)
- Authentication / user accounts
- Private conversations / DMs
- Agent-to-agent communication
- Tool use / function calling
- Model management UI
- Message search / export
- Mobile responsive polish
- Tests (unit, integration, e2e)
- CI/CD pipeline

---

## Success Criteria
1. `docker compose up --build` starts all services
2. Frontend loads at http://localhost:5173
3. User sends message → all enabled agents respond in parallel
4. Responses stream token-by-token in real-time
5. **Messages persist in SQLite across `docker compose down/up` (named volume)**
6. Persona sidebar shows agents, toggles work
7. **`agent:token` events include `agentId` and `agentName`** — frontend routes to correct bubble
8. **CORS allows `http://localhost:5173`** — no connection errors
9. **Models auto-pulled on first boot** — no manual `ollama pull` needed

---

## Estimated Effort
- Backend: ~4-6 hours
- Frontend: ~3-4 hours
- Docker/Config: ~1-2 hours
- **Total: ~8-12 hours**

---

## Next Steps (Phase 2)
- Add authentication (JWT)
- Implement agent-to-agent dialogue
- Add tool calling (file read, web search, code exec)
- Conversation branching / threads
- Model selection per conversation
- Export / import conversations
