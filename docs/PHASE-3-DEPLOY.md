# Phase 3 — 운영 배포 (Cloudflare Pages + R2 + RunPod)

## 아키텍처

```
Browser (Pages CDN)
  ├─ POST /api/storage/upload  → R2 presigned PUT URL 발급
  ├─ PUT  R2 (직접 업로드)
  ├─ POST /v2/vocal-remover/run → Edge가 RunPod API 프록시 (API 키는 서버만)
  └─ GET  /v2/.../status/...    → RunPod 상태 프록시

RunPod Worker (Docker)
  ├─ R2에서 input 다운로드 (boto3)
  ├─ Demucs 분리
  └─ R2에 output 업로드
```

브라우저에는 **RunPod API 키·R2 Secret**이 노출되지 않습니다.

---

## 1. Cloudflare R2

1. R2 버킷 생성 (`infotools-prod` 등)
2. **Public access** 또는 Custom Domain 연결 → `R2_PUBLIC_BASE_URL`
3. CORS (브라우저 presigned PUT용):

```json
[
  {
    "AllowedOrigins": ["https://YOUR_PAGES_DOMAIN", "http://127.0.0.1:5173"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

4. R2 API 토큰 생성 → Account ID, Access Key, Secret Key

---

## 2. RunPod Serverless

### 로컬 Docker에서 AI 먼저 검증 (권장)

RunPod에 올리기 전에 **같은 이미지**로 HTTP 테스트:

→ **[docs/DOCKER-LOCAL-TEST.md](DOCKER-LOCAL-TEST.md)**

```powershell
npm run docker:vocal-remover
npm run docker:run:vocal-remover
npm run docker:test:vocal-remover -- "C:\path\to\song.mp3"
```

### Docker 빌드 & 푸시

```powershell
cd "E:\Develop Program\4.InfoTools-Cloud\InfoTools-Cloud"
npm run docker:vocal-remover
docker tag infotools/vocal-remover:latest YOUR_REGISTRY/vocal-remover:latest
docker push YOUR_REGISTRY/vocal-remover:latest
```

### RunPod 엔드포인트 환경 변수

| 변수 | 설명 |
|------|------|
| `INFOTOOLS_STORAGE_PROVIDER` | `r2` |
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 API key |
| `R2_SECRET_ACCESS_KEY` | R2 secret |
| `R2_BUCKET` | 버킷 이름 |
| `R2_PUBLIC_BASE_URL` | 공개 URL 베이스 |
| `RUNPOD_SERVERLESS` | `1` (RunPod 배포 시; 로컬 HTTP 테스트는 `INFOTOOLS_LOCAL_SERVER=1`) |

### RunPod 콘솔

1. Serverless → New Endpoint
2. Docker image 등록
3. GPU: RTX 4090 / A40 등
4. Endpoint URL 복사: `https://api.runpod.ai/v2/<ENDPOINT_ID>`

---

## 3. Cloudflare Pages

### 로컬 Pages Functions 테스트

```powershell
copy apps\web\.dev.vars.example apps\web\.dev.vars
# .dev.vars 값 입력

npm install
npm run dev:pages
```

→ http://127.0.0.1:5173 (Functions + 정적 파일)

### Wrangler 시크릿 (운영)

**관리자 UI + ADMIN_KV만으로 R2/RunPod를 운영할 수 있습니다.** 아래 시크릿은 최소 필수 + 선택 fallback 입니다.

```powershell
cd apps\web

# 필수 — 관리자 인증
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD

# 선택 — 관리자 UI/KV 설정 전 fallback 또는 비상용
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler secret put R2_BUCKET
npx wrangler secret put R2_PUBLIC_BASE_URL
npx wrangler secret put RUNPOD_API_KEY
npx wrangler secret put RUNPOD_VOCAL_REMOVER_ENDPOINT
```

### ADMIN_KV (운영 필수)

관리자 설정(R2/RunPod API 키, 버킷, 엔드포인트)을 Pages에 영구 저장하려면 KV 바인딩이 필요합니다.

```powershell
cd apps\web
npx wrangler kv namespace create INFOTOOLS_ADMIN
npx wrangler kv namespace create INFOTOOLS_ADMIN --preview
```

`wrangler.toml`의 `[[kv_namespaces]]` 주석을 해제하고 생성된 `id` / `preview_id`를 입력한 뒤 재배포합니다.

배포 후 `/admin/` 에서:

1. **활성 환경**을 `production` (또는 `staging`)으로 선택
2. **API 연동 및 R2 스토리지 설정** — Account ID, Access Key, Secret, RunPod API Key 입력
3. **활성 환경 연동 프로필** — 버킷 이름, 공개 URL, RunPod Endpoint URL 입력
4. **공통 설정 저장** 클릭

저장된 값은 KV에 PBKDF2 암호화(`enc:...`)로 보관되며, Edge Functions가 presign/RunPod 프록시 시 복호화해 사용합니다.

### 배포

```powershell
npm run deploy:pages
```

또는 GitHub 연동 후 Cloudflare Pages 빌드:

- Build command: `npm run build -w @infotools/web`
- Output directory: `apps/web/dist`
- Root: monorepo root (`npm install` at root)

---

## 4. 운영 설정 파일

실제 값은 git에 넣지 않습니다.

```powershell
copy config\environments\production.example.json config\environments\production.json
# production.json 편집 후 wrangler vars 또는 KV로 반영
```

Admin UI (`/admin/`)에서 **staging / production** 전환 및 R2/RunPod 설정을 변경합니다. **`ADMIN_KV` 바인딩이 있어야 저장이 유지**됩니다.

`ADMIN_TOKEN` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` 설정 시 admin API는 `Authorization: Bearer <token>` 및 로그인 인증이 필요합니다.

Wrangler 시크릿(`R2_*`, `RUNPOD_*`)은 관리자 UI 값이 없을 때만 fallback으로 사용됩니다.

---

## 5. 체크리스트

- [ ] R2 버킷 + CORS + public domain
- [ ] RunPod endpoint 배포 + worker env vars (R2 credentials on RunPod console)
- [ ] Pages: `ADMIN_KV` 바인딩 + `ADMIN_TOKEN` / `ADMIN_USERNAME` / `ADMIN_PASSWORD`
- [ ] `/admin/` 에서 R2 키 · RunPod API Key · 버킷 · 엔드포인트 저장
- [ ] `npm run dev:pages` 로 presign 업로드 · RunPod 프록시 테스트
- [ ] Vocal Remover E2E (업로드 → 분리 → 재생/다운로드)
- [ ] `npm run deploy:pages` 운영 배포

---

## 로컬 Mock vs 운영

| | Phase 1 (mock) | Phase 3 (prod) |
|--|----------------|----------------|
| API | `apps/mock-infra` :19427 | Pages Functions |
| Storage | 로컬 디스크 | R2 presigned |
| Inference | in-process handler | RunPod serverless |
| 시작 | `npm run dev` | `npm run dev:pages` / deploy |
