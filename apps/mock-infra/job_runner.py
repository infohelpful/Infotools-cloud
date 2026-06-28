"""Background job execution for mock RunPod."""

from __future__ import annotations

import importlib.util
import json
import sys
import threading
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_REPO_ROOT = Path(__file__).resolve().parents[2]
_LIBS = _REPO_ROOT / "libs" / "py"
if str(_LIBS) not in sys.path:
    sys.path.insert(0, str(_LIBS))


@dataclass
class JobRecord:
    id: str
    service_id: str
    status: str = "IN_QUEUE"
    input: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] | None = None
    error: str | None = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()

    def create(self, service_id: str, inp: dict[str, Any]) -> JobRecord:
        job_id = str(uuid.uuid4())
        job = JobRecord(id=job_id, service_id=service_id, input={**inp, "jobId": job_id})
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            for k, v in fields.items():
                setattr(job, k, v)
            job.updated_at = datetime.now(timezone.utc).isoformat()


def _load_handler(service_id: str):
    handler_path = _REPO_ROOT / "services" / service_id / "src" / "handler.py"
    if not handler_path.is_file():
        raise ValueError(f"unknown service: {service_id}")
    src_dir = str(handler_path.parent)
    if src_dir not in sys.path:
        sys.path.insert(0, src_dir)
    spec = importlib.util.spec_from_file_location(f"{service_id}_handler", handler_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load handler: {handler_path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


CACHE_FILE = Path(__file__).resolve().parent / "cached_stems.json"
_cache_lock = threading.Lock()

def _load_cache() -> dict[str, Any]:
    if not CACHE_FILE.is_file():
        return {}
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}

def _save_cache(data: dict[str, Any]) -> None:
    try:
        CACHE_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass

def get_cached_result(service_id: str, file_hash: str, fmt: str) -> dict[str, Any] | None:
    with _cache_lock:
        cache = _load_cache()
        key = f"{service_id}:{file_hash}:{fmt}"
        return cache.get(key)

def save_to_cache(service_id: str, file_hash: str, fmt: str, output: dict[str, Any]) -> None:
    with _cache_lock:
        cache = _load_cache()
        key = f"{service_id}:{file_hash}:{fmt}"
        cache[key] = output
        _save_cache(cache)


def clear_service_cache(service_id: str) -> None:
    with _cache_lock:
        cache = _load_cache()
        keys_to_remove = [k for k in cache.keys() if k.startswith(f"{service_id}:")]
        for k in keys_to_remove:
            cache.pop(k, None)
        _save_cache(cache)


def run_job_async(store: JobStore, job: JobRecord) -> None:
    def _worker() -> None:
        store.update(job.id, status="IN_PROGRESS")
        try:
            mod = _load_handler(job.service_id)
            out = mod.run_job(job.input)
            store.update(job.id, status="COMPLETED", output=out)
            
            # 해시 캐시에 저장
            file_hash = job.input.get("fileHash")
            if file_hash:
                fmt = job.input.get("format", "wav").lower()
                save_to_cache(job.service_id, file_hash, fmt, out)
        except Exception as exc:
            store.update(
                job.id,
                status="FAILED",
                error=str(exc),
            )
            traceback.print_exc()

    threading.Thread(target=_worker, daemon=True, name=f"job-{job.id[:8]}").start()


def job_to_runpod_status(job: JobRecord) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": job.id,
        "status": job.status,
    }
    if job.status == "COMPLETED" and job.output:
        body["output"] = job.output
    if job.status == "FAILED":
        body["error"] = job.error or "unknown error"
    return body
