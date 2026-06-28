# Docker 로컬 AI 검증 (Vocal Remover)

RunPod에 올리기 **전에**, 같은 Docker 이미지로 **진짜 Demucs**가 도는지 확인하는 절차입니다.

## 1. 이미지 빌드

```powershell
cd "E:\Develop Program\4.InfoTools-Cloud\InfoTools-Cloud"

# 기본 (첫 실행 시 Demucs가 모델 mdx_extra_q 자동 다운로드)
npm run docker:vocal-remover

# 빌드 중 모델까지 미리 받기 (이미지 커짐, 첫 실행 빠름)
npm run docker:vocal-remover:preload
```

> **모델 파일 위치:** `models/` 폴더에 넣는 구조가 **아닙니다.**  
> Demucs가 컨테이너 안 `~/.cache/torch/hub` 등에 자동 저장합니다.  
> 재다운로드 방지: `-v demucs-cache:/root/.cache` 볼륨 마운트 가능.

## 2. AI 서버만 단독 실행 (웹 UI 끄고)

```powershell
# GPU (NVIDIA Container Toolkit 필요)
npm run docker:run:vocal-remover

# CPU만
npm run docker:run:vocal-remover -- --cpu

# 가짜 AI (Demucs 없이 연결만 확인)
npm run docker:run:vocal-remover -- --mock
```

→ http://127.0.0.1:8000/health

## 3. curl로 진짜 파일 테스트

```powershell
curl -X POST http://127.0.0.1:8000/separate ^
  -F "audio=@C:\Music\my_song.mp3" ^
  -F "stem=vocals" ^
  -F "format=mp3" ^
  --output data\docker-test-output\vocals.mp3
```

| 필드 | 값 |
|------|-----|
| `stem` | `vocals` / `instrumental` / `both`(zip) |
| `format` | `wav` / `mp3` / `flac` |
| `device` | `auto` / `cpu` / `cuda` |

또는 자동 스크립트 (서버가 떠 있어야 함):

```powershell
npm run docker:test:vocal-remover -- "C:\Music\my_song.mp3"
```

결과: `data/docker-test-output/vocals.*`, `instrumental.*`

## 4. 검증 후 흐름

```
[1] docker:run + curl/test  →  AI 정상
[2] docker push + RunPod    →  RUNPOD_SERVERLESS=1 로 배포
[3] dev:pages / deploy      →  웹 ↔ RunPod ↔ R2 연동
```

RunPod 엔드포인트 환경 변수는 `RUNPOD_SERVERLESS=1` (HTTP 서버 아님, 스토리지 키로 입출력).
