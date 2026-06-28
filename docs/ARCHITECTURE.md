# InfoTools Cloud Architecture

## Layers

| Layer | Role |
|-------|------|
| `apps/web` | Vite SPA — dashboard, per-tool sites, admin |
| `packages/web-sdk` | Upload, job submit, poll (provider-agnostic) |
| `apps/mock-infra` | Phase 1: mock R2 + RunPod-compatible API |
| `services/*` | Per-tool RunPod handlers (Docker) |
| `libs/py/infotools` | Shared Python (storage client, future R2) |
| `config/` | Service registry + environment profiles |

## Request flow (Vocal Remover)

```
Browser → upload (POST /api/storage/upload)
       → submit job (POST /v2/vocal-remover/run)
       → poll (GET /v2/vocal-remover/status/:id)
       → play/download output URLs (/api/storage/object/...)
```

Handler downloads input from storage, runs Demucs (or mock), uploads stems back.

## Phase roadmap

1. **local-mock** — single FastAPI process, filesystem R2, in-process jobs
2. **staging** — real R2 presigns via Cloudflare Pages Functions
3. **production** — RunPod + R2 via Pages Functions (`apps/web/functions/`)

## Extensibility

- New tool: `npm run scaffold -- <id> "<name>"` + web site + `job_runner` auto-loads `services/<id>/src/handler.py`
- Registry: `config/services.registry.json` drives dashboard and public config
