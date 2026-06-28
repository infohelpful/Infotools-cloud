# InfoTools Cloud

클라우드 기반 확장형 AI SaaS — **Vocal Remover** 파일럿.

## 로컬 Python (필수)

**모든 로컬 개발·테스트는 Python 3.12 + `.venv` 만 사용합니다.**

- CUDA torch(Demucs GPU)는 **3.12에서만** 공식 wheel 제공
- Python 3.14 등 다른 버전 `.venv` 는 `npm run setup` 시 자동 제거 후 재생성

```powershell
cd "E:\Develop Program\4.InfoTools-Cloud\InfoTools-Cloud"
npm install
npm run setup          # py -3.12 → .venv + CUDA torch( GPU 있을 때 ) + demucs
copy .env.example .env
npm run dev
```


| 명령 | 설명 |
|------|------|
| `npm run setup` | Python 3.12 venv 생성·패키지 설치 (표준) |
| `npm run dev` | Mock API + AI + Vite 웹 UI |
| `npm run dev:mock` | 가짜 AI만 (빠른 UI 확인) |
| `npm run dev:stop` | :19427 / :8000 포트 정리 |
| `npm run smoke` | E2E 스모크 (mock-infra 실행 중) |

| URL | 설명 |
|-----|------|
| http://127.0.0.1:5173/sites/vocal-remover/ | 음악 업로드 → 분리 |
| http://127.0.0.1:19427/health | Mock API |
| http://127.0.0.1:8000/health | AI 서버 (로컬/Docker) |

GPU 없이 CPU만 쓰려면: `set INFOTOOLS_DEV_CPU=1` 후 `npm run setup` / `npm run dev`

## 구조

```
InfoTools-Cloud/
├── apps/
│   ├── mock-infra/     # Mock R2 + RunPod API (Phase 1)
│   └── web/            # Vite 프론트 (대시보드 + vocal-remover)
├── packages/web-sdk/   # 업로드 · 잡 제출 · 폴링 공통 SDK
├── services/
│   ├── _template/      # 신규 서비스 스캐폴드 원본
│   └── vocal-remover/  # Demucs 분리 RunPod 핸들러
├── libs/py/infotools/  # Python 공통 (스토리지 클라이언트)
└── config/             # 서비스 레지스트리 · 환경 설정
```

## 수동 mock-infra (선택)

`npm run dev` 가 API를 함께 띄우므로 보통 불필요합니다.

```powershell
npm run dev:infra
```

→ http://127.0.0.1:19427/health

## Demucs 저장 오류 (torchcodec)

Demucs CLI는 분리 후 `torchaudio.save` → **torchcodec** 이 필요합니다.  
로컬/클라우드 공통으로 **Python API + soundfile** 저장(`demucs_engine.py`)을 사용합니다.  
Docker 이미지에 `libsndfile1` 포함됨.

Mock AI 없이 실제 Demucs: `npm run setup` 후 `INFOTOOLS_MOCK_AI` 미설정.

개발 중 Demucs 없이 UI만: `$env:INFOTOOLS_MOCK_AI = "1"` 또는 `npm run dev:mock`

## 신규 서비스 추가

```powershell
npm run scaffold -- my-new-tool "My New Tool"
```

## Docker로 진짜 AI 검증 (RunPod 배포 전 필수)

웹 UI 없이 **Docker + curl** 만으로 Demucs 분리를 확인합니다.

```powershell
npm run docker:vocal-remover          # 빌드
npm run docker:run:vocal-remover      # 터미널 1 — AI 서버 :8000
npm run docker:test:vocal-remover -- "C:\path\to\song.mp3"   # 터미널 2
```

자세히: **[docs/DOCKER-LOCAL-TEST.md](docs/DOCKER-LOCAL-TEST.md)**

## Phase 3 (운영 전환)

자세한 배포 가이드: **[docs/PHASE-3-DEPLOY.md](docs/PHASE-3-DEPLOY.md)**

```powershell
# Pages Functions + R2 presign + RunPod proxy (로컬)
copy apps\web\.dev.vars.example apps\web\.dev.vars
npm install
npm run dev:pages

# RunPod Docker
npm run docker:vocal-remover

# Pages 배포
npm run deploy:pages
```
