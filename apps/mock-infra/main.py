"""Mock Cloudflare R2 + RunPod + Admin config API."""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIBS = _REPO_ROOT / "libs" / "py"
if str(_LIBS) not in sys.path:
    sys.path.insert(0, str(_LIBS))

from infotools.storage import guess_content_type, object_path, sanitize_storage_key  # noqa: E402

from job_runner import JobStore, job_to_runpod_status, run_job_async, get_cached_result  # noqa: E402
from runpod_proxy import proxy_runpod, uses_runpod_proxy  # noqa: E402

PORT = int(os.environ.get("INFOTOOLS_MOCK_INFRA_PORT", "19427"))
R2_ROOT = Path(os.environ.get("INFOTOOLS_MOCK_R2_ROOT", str(_REPO_ROOT / "data" / "mock-r2")))

os.environ.setdefault("INFOTOOLS_MOCK_AI", "1")
os.environ.setdefault("INFOTOOLS_PUBLIC_BASE_URL", "http://127.0.0.1:19427")
os.environ.setdefault("INFOTOOLS_MOCK_R2_ROOT", str(R2_ROOT))

_ai_url = os.environ.get("INFOTOOLS_AI_SERVER_URL", "").strip()
if _ai_url:
    os.environ["INFOTOOLS_MOCK_AI"] = "0"


def _ai_dev_status() -> dict:
    """웹 UI — 현재 분리 엔진이 진짜 Demucs인지 표시."""
    import urllib.error
    import urllib.request

    mock_env = os.environ.get("INFOTOOLS_MOCK_AI", "").strip().lower() in {"1", "true", "yes"}
    ai_url = os.environ.get("INFOTOOLS_AI_SERVER_URL", "").strip()
    if not ai_url:
        return {
            "engine": "mock",
            "mockSeparation": True,
            "demucsInstalled": False,
            "message": "가짜 분리 모드 — MR·보컬 모두 원본과 동일합니다. npm run dev (Docker/Demucs 필요)",
        }
    try:
        with urllib.request.urlopen(f"{ai_url.rstrip('/')}/health", timeout=5) as resp:
            h = json.loads(resp.read().decode())
        mock = bool(h.get("mockAi")) or mock_env
        demucs_ok = bool(h.get("demucsInstalled"))
        if mock:
            msg = "AI 서버가 MOCK 모드입니다 — 실제 분리되지 않습니다."
        elif not demucs_ok:
            msg = "AI 서버에 Demucs가 없습니다."
        else:
            msg = f"Demucs 실제 분리 ({h.get('model', 'mdx_extra_q')})"
        return {
            "engine": "ai-server",
            "aiServerUrl": ai_url,
            "mockSeparation": mock,
            "demucsInstalled": demucs_ok,
            "model": h.get("model"),
            "message": msg,
        }
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {
            "engine": "ai-server",
            "aiServerUrl": ai_url,
            "mockSeparation": True,
            "demucsInstalled": False,
            "message": f"AI 서버 연결 실패: {exc}",
        }


CONFIG_PATH = _REPO_ROOT / "config"
ADMIN_STATE_PATH = _REPO_ROOT / "data" / "admin-state.json"

app = FastAPI(title="InfoTools Mock Infra", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

jobs = JobStore()
R2_ROOT.mkdir(parents=True, exist_ok=True)


def _load_json(path: Path) -> dict:
    if not path.is_file():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


import base64
import os
import hashlib

SECRET_PBKDF2_KEY = b"cloudflare-r2-secure-key-generation-phrase-1029"

def derive_keystream(length: int, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac('sha256', SECRET_PBKDF2_KEY, salt, 1000, dklen=length)

def encrypt_val(val: str) -> str:
    if not val:
        return ""
    salt = os.urandom(16)
    plaintext_bytes = val.encode('utf-8')
    keystream = derive_keystream(len(plaintext_bytes), salt)
    ciphertext = bytes(p ^ k for p, k in zip(plaintext_bytes, keystream))
    return f"enc:{salt.hex()}:{ciphertext.hex()}"

def decrypt_val(val: str) -> str:
    if not val or not val.startswith("enc:"):
        return val
    try:
        parts = val.split(":")
        if len(parts) != 3:
            return ""
        salt = bytes.fromhex(parts[1])
        ciphertext = bytes.fromhex(parts[2])
        keystream = derive_keystream(len(ciphertext), salt)
        plaintext_bytes = bytes(c ^ k for c, k in zip(ciphertext, keystream))
        return plaintext_bytes.decode('utf-8')
    except Exception:
        return ""


def _save_admin_state(state: dict) -> None:
    import copy
    to_save = copy.deepcopy(state)
    to_save["r2AccountId"] = encrypt_val(to_save.get("r2AccountId", ""))
    to_save["r2S3Endpoint"] = encrypt_val(to_save.get("r2S3Endpoint", ""))
    to_save["r2AccessKeyId"] = encrypt_val(to_save.get("r2AccessKeyId", ""))
    to_save["r2SecretAccessKey"] = encrypt_val(to_save.get("r2SecretAccessKey", ""))
    to_save["runpodApiKey"] = encrypt_val(to_save.get("runpodApiKey", ""))

    ADMIN_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    ADMIN_STATE_PATH.write_text(json.dumps(to_save, indent=2, ensure_ascii=False), encoding="utf-8")


def _merge_environment_profiles(saved: dict | None) -> dict:
    defaults = {
        "local-mock": _load_json(CONFIG_PATH / "environments" / "local.mock.json"),
        "staging": _load_json(CONFIG_PATH / "environments" / "staging.example.json"),
        "production": _load_json(CONFIG_PATH / "environments" / "production.example.json"),
    }
    merged = dict(defaults)
    for env_id, profile in (saved or {}).items():
        base = dict(merged.get(env_id) or {})
        for key, value in (profile or {}).items():
            if isinstance(value, dict) and isinstance(base.get(key), dict):
                base[key] = {**base[key], **value}
            else:
                base[key] = value
        merged[env_id] = base
    return merged


def _admin_state() -> dict:
    registry = _load_json(CONFIG_PATH / "services.registry.json")
    if ADMIN_STATE_PATH.is_file():
        state = _load_json(ADMIN_STATE_PATH)
        if "defaultRewardedAdUnit" not in state:
            state["defaultRewardedAdUnit"] = registry.get("defaultRewardedAdUnit", "")
        if "adsenseClientId" not in state:
            state["adsenseClientId"] = ""
        if "adsenseTopSlot" not in state:
            state["adsenseTopSlot"] = ""
        if "adsenseBottomSlot" not in state:
            state["adsenseBottomSlot"] = ""
        state["r2AccountId"] = decrypt_val(state.get("r2AccountId", ""))
        state["r2S3Endpoint"] = decrypt_val(state.get("r2S3Endpoint", ""))
        state["r2AccessKeyId"] = decrypt_val(state.get("r2AccessKeyId", ""))
        state["r2SecretAccessKey"] = decrypt_val(state.get("r2SecretAccessKey", ""))
        state["runpodApiKey"] = decrypt_val(state.get("runpodApiKey", ""))
        state["environments"] = _merge_environment_profiles(state.get("environments"))
        return state
    return {
        "activeEnvironment": "local-mock",
        "defaultRewardedAdUnit": registry.get("defaultRewardedAdUnit", ""),
        "adsenseClientId": "",
        "adsenseTopSlot": "",
        "adsenseBottomSlot": "",
        "r2AccountId": "",
        "r2S3Endpoint": "",
        "r2AccessKeyId": "",
        "r2SecretAccessKey": "",
        "runpodApiKey": "",
        "environments": {
            "local-mock": _load_json(CONFIG_PATH / "environments" / "local.mock.json"),
            "staging": _load_json(CONFIG_PATH / "environments" / "staging.example.json"),
            "production": _load_json(CONFIG_PATH / "environments" / "production.example.json"),
        },
        "services": registry.get("services", []),
    }


@app.get("/health")
def health() -> dict:
    body = {"ok": True, "mode": "mock", "r2Root": str(R2_ROOT)}
    body["devAi"] = _ai_dev_status()
    return body


def _rewarded_ads_public(state: dict) -> dict:
    registry = _load_json(CONFIG_PATH / "services.registry.json")
    default_unit = (
        state.get("defaultRewardedAdUnit")
        or registry.get("defaultRewardedAdUnit")
        or "/22639388115/rewarded_web_example"
    )
    services = state.get("services") or []
    by_service = {}
    for s in services:
        sid = s.get("id")
        unit = (s.get("rewardedAdUnit") or "").strip()
        if sid and unit:
            by_service[sid] = unit
    return {"default": default_unit, "byService": by_service}


@app.get("/api/config/public")
def public_config() -> dict:
    """Web UI — active environment endpoints (no secrets)."""
    state = _admin_state()
    env_id = state.get("activeEnvironment", "local-mock")
    env = (state.get("environments") or {}).get(env_id) or {}
    services = [s for s in state.get("services", []) if s.get("enabled", True)]
    api_base = env.get("apiBase")
    if api_base is None:
        api_base = env.get("storage", {}).get("baseUrl") or f"http://127.0.0.1:{PORT}"
    return {
        "activeEnvironment": env_id,
        "apiBase": api_base,
        "storage": env.get("storage", {}),
        "inference": env.get("inference", {}),
        "services": services,
        "rewardedAds": _rewarded_ads_public(state),
        "devAi": _ai_dev_status(),
        "adsenseClientId": state.get("adsenseClientId", ""),
        "adsenseTopSlot": state.get("adsenseTopSlot", ""),
        "adsenseBottomSlot": state.get("adsenseBottomSlot", ""),
    }


MOCK_ADMIN_TOKEN = "mock-admin-token-12345"

ADMIN_SALT = bytes.fromhex("147baaddbe07ca2de3a3719f74abf2bf")
ADMIN_HASH = bytes.fromhex("d385147acf401b0d7401558ae2e4d8384b16a307da53038121b82e2119e0c672")

def verify_admin_password(password: str) -> bool:
    import hmac
    h = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), ADMIN_SALT, 100000)
    return hmac.compare_digest(h, ADMIN_HASH)


def check_admin_auth(request: Request):
    auth = request.headers.get("Authorization") or ""
    if auth != f"Bearer {MOCK_ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="unauthorized")


@app.post("/api/admin/login")
async def admin_login(request: Request) -> dict:
    body = await request.json()
    username = body.get("username")
    password = body.get("password") or ""
    if username == "infohelpful" and verify_admin_password(password):
        return {"token": MOCK_ADMIN_TOKEN}
    raise HTTPException(status_code=401, detail="invalid credentials")


@app.get("/api/admin/state")
def admin_get_state(request: Request) -> dict:
    check_admin_auth(request)
    return _admin_state()


@app.post("/api/admin/state")
async def admin_set_state(request: Request) -> dict:
    check_admin_auth(request)
    body = await request.json()
    state = _admin_state()
    if "activeEnvironment" in body:
        state["activeEnvironment"] = body["activeEnvironment"]
    if "defaultRewardedAdUnit" in body:
        state["defaultRewardedAdUnit"] = body["defaultRewardedAdUnit"]
    if "adsenseClientId" in body:
        state["adsenseClientId"] = body["adsenseClientId"]
    if "adsenseTopSlot" in body:
        state["adsenseTopSlot"] = body["adsenseTopSlot"]
    if "adsenseBottomSlot" in body:
        state["adsenseBottomSlot"] = body["adsenseBottomSlot"]
    if "r2AccountId" in body:
        state["r2AccountId"] = body["r2AccountId"]
    if "r2S3Endpoint" in body:
        state["r2S3Endpoint"] = body["r2S3Endpoint"]
    if "r2AccessKeyId" in body:
        state["r2AccessKeyId"] = body["r2AccessKeyId"]
    if "r2SecretAccessKey" in body:
        state["r2SecretAccessKey"] = body["r2SecretAccessKey"]
    if "runpodApiKey" in body:
        state["runpodApiKey"] = body["runpodApiKey"]
    if "environments" in body and isinstance(body["environments"], dict):
        state["environments"] = _merge_environment_profiles(
            {**(state.get("environments") or {}), **body["environments"]}
        )
    if "services" in body:
        state["services"] = body["services"]
    _save_admin_state(state)
    return state


def check_audio_duration(filepath: str) -> float:
    """오디오 파일 재생 시간(초)을 이중 검증(soundfile 및 ffprobe fallback)하여 측정합니다."""
    # 1. soundfile 시도
    try:
        import soundfile as sf
        info = sf.info(filepath)
        return info.duration
    except Exception:
        pass

    # 2. ffprobe 시도 (M4A, AAC 등 libsndfile 미지원 포맷 대응)
    try:
        import subprocess
        cmd = [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            filepath
        ]
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(result.stdout.strip())
    except Exception as e:
        raise ValueError(f"오디오 길이를 읽을 수 없습니다: {e}")


@app.post("/api/storage/upload")
async def storage_upload(
    file: UploadFile = File(...),
    prefix: str = "uploads",
) -> dict:
    safe_prefix = sanitize_storage_key(prefix.rstrip("/"))
    name = file.filename or "upload.bin"
    key = f"{safe_prefix}/{uuid.uuid4().hex}-{name}"
    dest = object_path(R2_ROOT, key)
    dest.parent.mkdir(parents=True, exist_ok=True)
    data = await file.read()
    dest.write_bytes(data)

    # 2차 검증: 파일 크기 및 재생 시간 확인 (vocal-remover 입력 파일인 경우)
    if "vocal-remover" in safe_prefix:
        # 1. 파일 크기 검증 (30MB 제한)
        if len(data) > 30 * 1024 * 1024:
            dest.unlink(missing_ok=True)
            raise HTTPException(
                status_code=400,
                detail="오디오 파일 크기가 30MB를 초과할 수 없습니다."
            )

        try:
            duration = check_audio_duration(str(dest))
            if duration > 360:
                dest.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=400,
                    detail="오디오 파일 재생 시간이 6분(360초)을 초과할 수 없습니다."
                )
        except Exception as e:
            dest.unlink(missing_ok=True)
            if isinstance(e, HTTPException):
                raise e
            raise HTTPException(
                status_code=400,
                detail=f"유효한 오디오 파일이 아니거나 길이 분석에 실패했습니다: {e}"
            )

    return {
        "key": key,
        "url": f"/api/storage/object/{key}",
        "size": len(data),
        "contentType": file.content_type or guess_content_type(dest),
    }


@app.put("/api/storage/object/{key:path}")
async def storage_put_object(key: str, request: Request) -> dict:
    safe = sanitize_storage_key(key)
    dest = object_path(R2_ROOT, safe)
    dest.parent.mkdir(parents=True, exist_ok=True)
    body = await request.body()
    dest.write_bytes(body)
    return {"key": safe, "size": len(body)}


@app.get("/api/storage/object/{key:path}")
def storage_get_object(key: str):
    safe = sanitize_storage_key(key)
    path = object_path(R2_ROOT, safe)
    if not path.is_file():
        raise HTTPException(404, "object not found")
    return FileResponse(path, media_type=guess_content_type(path), filename=path.name)


@app.post("/api/admin/services/{service_id}/cleanup")
def admin_cleanup_service_storage(service_id: str, request: Request) -> dict:
    check_admin_auth(request)

    folder = R2_ROOT / service_id
    if not folder.is_dir():
        return {"deleted": 0, "freedBytes": 0}

    deleted_count = 0
    freed_bytes = 0

    # 모든 파일 즉시 삭제
    for p in folder.rglob("*"):
        if p.is_file():
            try:
                freed_bytes += p.stat().st_size
                p.unlink(missing_ok=True)
                deleted_count += 1
            except Exception:
                pass

    # 빈 디렉터리 정리
    for p in sorted(folder.rglob("*"), key=lambda x: len(str(x)), reverse=True):
        if p.is_dir():
            try:
                p.rmdir()
            except OSError:
                pass

    # 캐시 무효화 적용
    from job_runner import clear_service_cache
    clear_service_cache(service_id)

    return {"deleted": deleted_count, "freedBytes": freed_bytes}


def _runpod_proxy_response(service_id: str, path_suffix: str, *, method: str = "GET", body: bytes | None = None):
    state = _admin_state()
    status, payload = proxy_runpod(state, service_id, path_suffix, method=method, body=body)
    if status >= 400:
        raise HTTPException(status_code=status, detail=payload if isinstance(payload, dict) else str(payload))
    return payload


@app.post("/v2/{service_id}/run")
async def runpod_run(service_id: str, request: Request) -> dict:
    raw_body = await request.body()
    state = _admin_state()
    if uses_runpod_proxy(state):
        result = _runpod_proxy_response(service_id, "/run", method="POST", body=raw_body)
        return result if isinstance(result, dict) else {"raw": result}

    body = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
    inp = body.get("input") if isinstance(body.get("input"), dict) else body
    inp = inp or {}

    file_hash = inp.get("fileHash")
    fmt = inp.get("format", "wav").lower()
    if file_hash:
        cached = get_cached_result(service_id, file_hash, fmt)
        if cached:
            job = jobs.create(service_id, inp)
            jobs.update(job.id, status="COMPLETED", output=cached)
            return {"id": job.id, "status": "COMPLETED"}

    job = jobs.create(service_id, inp)
    run_job_async(jobs, job)
    return {"id": job.id, "status": job.status}


@app.get("/v2/{service_id}/status/{job_id}")
def runpod_status(service_id: str, job_id: str) -> dict:
    state = _admin_state()
    if uses_runpod_proxy(state):
        result = _runpod_proxy_response(service_id, f"/status/{job_id}")
        return result if isinstance(result, dict) else {"raw": result}

    job = jobs.get(job_id)
    if not job or job.service_id != service_id:
        raise HTTPException(404, "job not found")
    return job_to_runpod_status(job)


@app.post("/v2/{service_id}/runsync")
async def runpod_runsync(service_id: str, request: Request) -> dict:
    raw_body = await request.body()
    state = _admin_state()
    if uses_runpod_proxy(state):
        result = _runpod_proxy_response(service_id, "/runsync", method="POST", body=raw_body)
        return result if isinstance(result, dict) else {"raw": result}

    body = json.loads(raw_body.decode("utf-8") if raw_body else "{}")
    inp = body.get("input") if isinstance(body.get("input"), dict) else body
    job = jobs.create(service_id, inp or {})
    from job_runner import _load_handler

    jobs.update(job.id, status="IN_PROGRESS")
    try:
        mod = _load_handler(service_id)
        out = mod.run_job(job.input)
        jobs.update(job.id, status="COMPLETED", output=out)
    except Exception as exc:
        jobs.update(job.id, status="FAILED", error=str(exc))
        raise HTTPException(500, str(exc)) from exc
    return job_to_runpod_status(jobs.get(job.id))


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
