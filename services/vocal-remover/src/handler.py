"""
RunPod Serverless handler + local simulation.

Local:
  INFOTOOLS_PUBLIC_BASE_URL=http://127.0.0.1:19427 python src/handler.py \\
    --audio-key vocal-remover/test/input/sample.wav --format wav
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

_SRC = Path(__file__).resolve().parent
_REPO_ROOT = _SRC.parents[2]
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
if str(_REPO_ROOT / "libs" / "py") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "libs" / "py"))

from infotools.storage import storage_client_from_env, sanitize_storage_key  # noqa: E402

from ai_http_client import ai_server_url_from_env, separate_via_http  # noqa: E402
from separate import separate_audio  # noqa: E402

SERVICE_ID = "vocal-remover"


def _storage():
    return storage_client_from_env()


def _output_keys(job_id: str, fmt: str) -> tuple[str, str]:
    prefix = f"{SERVICE_ID}/{job_id}/output"
    return (
        f"{prefix}/instrumental.{fmt}",
        f"{prefix}/vocals.{fmt}",
    )


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


def run_job(job_input: dict) -> dict:
    audio_key = str(job_input.get("audioKey") or job_input.get("audio_key") or "").strip()
    if not audio_key:
        raise ValueError("audioKey required")
    fmt = str(job_input.get("format") or "wav").lower()
    device = job_input.get("device") or "auto"
    job_id = str(job_input.get("jobId") or uuid.uuid4())

    storage = _storage()
    with tempfile.TemporaryDirectory(prefix="vr-") as tmp:
        work = Path(tmp)
        ext = Path(audio_key).suffix.lower()
        if ext not in {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"}:
            ext = ".bin"
        local_in = work / f"input{ext}"
        storage.download_file(audio_key, local_in)

        # 2차 검증: 연산 서버 실행 전 오디오 재생 시간 재검증
        try:
            duration = check_audio_duration(str(local_in))
            if duration > 360:
                raise ValueError("오디오 파일 재생 시간이 6분(360초)을 초과할 수 없습니다.")
        except Exception as e:
            raise ValueError(f"오디오 재생 시간 검증 실패: {e}")

        def on_progress(pct: float, msg: str) -> None:
            print(f"[vocal-remover] {pct:.0f}% {msg}", flush=True)

        ai_url = ai_server_url_from_env()
        if ai_url:
            print(f"[vocal-remover] using AI server {ai_url}", flush=True)
            on_progress(10, "calling AI server")
            result = separate_via_http(
                ai_url,
                local_in,
                work / "out",
                output_format=fmt,
                device=str(device),
            )
        else:
            result = separate_audio(
                local_in,
                work / "out",
                output_format=fmt,
                device=device,
                on_progress=on_progress,
            )

        inst_key, voc_key = _output_keys(job_id, fmt)
        storage.upload_file(inst_key, Path(result["instrumental_path"]))
        storage.upload_file(voc_key, Path(result["vocals_path"]))

    return {
        "jobId": job_id,
        "instrumentalKey": inst_key,
        "vocalsKey": voc_key,
        "instrumentalUrl": storage.public_url(inst_key),
        "vocalsUrl": storage.public_url(voc_key),
        "durationSec": result.get("duration_sec", 0),
    }


def handler(event: dict) -> dict:
    """RunPod serverless entry (event['input'])."""
    inp = event.get("input") if isinstance(event.get("input"), dict) else event
    return run_job(inp or {})


def main() -> None:
    parser = argparse.ArgumentParser(description="Vocal Remover local handler test")
    parser.add_argument("--audio-key", required=True)
    parser.add_argument("--format", default="wav", choices=["wav", "mp3", "flac"])
    parser.add_argument("--device", default="auto")
    parser.add_argument("--job-id", default="")
    args = parser.parse_args()
    out = run_job(
        {
            "audioKey": args.audio_key,
            "format": args.format,
            "device": args.device,
            "jobId": args.job_id or f"local-{uuid.uuid4()}",
        }
    )
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    if os.environ.get("RUNPOD_SERVERLESS", "").strip().lower() in {"1", "true", "yes"}:
        import runpod  # type: ignore

        runpod.serverless.start({"handler": handler})
    else:
        main()