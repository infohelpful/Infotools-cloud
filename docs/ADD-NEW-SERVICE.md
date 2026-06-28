# 신규 AI 서비스 추가 체크리스트

## 1. 스캐폴드

```bash
npm run scaffold -- <service-id> "<Display Name>"
```

## 2. 백엔드 (`services/<id>/`)

- [ ] `service.manifest.json` — inputs/outputs 정의
- [ ] `src/handler.py` — `run_job()` 구현
- [ ] `Dockerfile` + `requirements.txt`
- [ ] 로컬 테스트: `python services/<id>/src/handler.py` (서비스별 args)

## 3. Mock infra (`apps/mock-infra/job_runner.py`)

- [ ] `services/<id>/src/handler.py` 존재 시 자동 로드 (별도 분기 불필요)

## 4. 프론트 (`apps/web/sites/<id>/`)

- [ ] `tool.config.json`
- [ ] `index.html`, `style.css`, `app.js` — `@infotools/web-sdk` 사용

## 5. 레지스트리

- [ ] `config/services.registry.json` — enabled / sitePath 확인

## 6. Admin

- [ ] 테스트 주소(local-mock)에서 UI 연동 확인
- [ ] 운영 RunPod 엔드포인트 등록 (Phase 3)

## 스토리지 키 규격

```
<service-id>/<job-id>/input/<filename>
<service-id>/<job-id>/output/...
```

## RunPod API 규격 (Mock과 동일)

```
POST /v2/<service-id>/run       { "input": { ... } }
GET  /v2/<service-id>/status/<job-id>
```
