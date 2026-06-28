"""
로컬 Docker AI 검증용 HTTP 서버.

  INFOTOOLS_LOCAL_SERVER=1 python local_server.py

  curl -X POST http://127.0.0.1:8000/separate \\
    -F "audio=@song.mp3" \\
    -F "stem=vocals" \\
    --output vocals.mp3
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402

from demucs_engine import _model_name  # noqa: E402

from separate import SUPPORTED_FORMATS, separate_audio  # noqa: E402

PORT = int(os.environ.get("INFOTOOLS_LOCAL_PORT", "8000"))
HOST = os.environ.get("INFOTOOLS_LOCAL_HOST", "0.0.0.0")

app = FastAPI(title="Vocal Remover Local AI", version="0.1.0")


@app.get("/health")
def health() -> dict:
    mock = os.environ.get("INFOTOOLS_MOCK_AI", "").strip().lower() in {"1", "true", "yes"}
    try:
        import demucs  # noqa: F401

        demucs_ok = True
    except ImportError:
        demucs_ok = False
    cuda_ok = False
    gpu_name = None
    try:
        import torch

        cuda_ok = bool(torch.cuda.is_available())
        if cuda_ok:
            gpu_name = torch.cuda.get_device_name(0)
    except Exception:
        pass
    return {
        "ok": True,
        "mode": "local-server",
        "mockAi": mock,
        "demucsInstalled": demucs_ok,
        "cudaAvailable": cuda_ok,
        "gpuName": gpu_name,
        "model": _model_name(),
    }


@app.post("/separate")
async def separate(
    audio: UploadFile = File(..., description="오디오 파일 (mp3/wav/flac 등)"),
    stem: str = Form("vocals", description="vocals | instrumental | both"),
    format: str = Form("wav", description="wav | mp3 | flac"),
    device: str = Form("auto", description="auto | cpu | cuda"),
):
    fmt = format.lower().strip()
    if fmt not in SUPPORTED_FORMATS:
        raise HTTPException(400, f"format must be one of: {', '.join(sorted(SUPPORTED_FORMATS))}")

    stem_key = stem.lower().strip()
    if stem_key not in {"vocals", "instrumental", "both"}:
        raise HTTPException(400, "stem must be vocals, instrumental, or both")

    suffix = Path(audio.filename or "input.bin").suffix or ".wav"
    work_root = Path(tempfile.mkdtemp(prefix="vr-local-"))
    try:
        local_in = work_root / f"input{suffix}"
        data = await audio.read()
        if not data:
            raise HTTPException(400, "empty file")
        local_in.write_bytes(data)

        out_dir = work_root / "out"
        result = separate_audio(
            local_in,
            out_dir,
            output_format=fmt,
            device=device,
            on_progress=lambda pct, msg: print(f"[separate] {pct:.0f}% {msg}", flush=True),
        )

        inst_path = Path(str(result["instrumental_path"]))
        voc_path = Path(str(result["vocals_path"]))

        if stem_key == "vocals":
            return FileResponse(
                voc_path,
                media_type=_guess_media(fmt),
                filename=f"vocals.{fmt}",
            )
        if stem_key == "instrumental":
            return FileResponse(
                inst_path,
                media_type=_guess_media(fmt),
                filename=f"instrumental.{fmt}",
            )

        zip_path = work_root / "stems.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(inst_path, f"instrumental.{fmt}")
            zf.write(voc_path, f"vocals.{fmt}")
        return FileResponse(zip_path, media_type="application/zip", filename="stems.zip")
    except HTTPException:
        shutil.rmtree(work_root, ignore_errors=True)
        raise
    except Exception as exc:
        shutil.rmtree(work_root, ignore_errors=True)
        raise HTTPException(500, str(exc)) from exc


@app.post("/separate/json")
async def separate_json(
    audio: UploadFile = File(...),
    format: str = Form("wav"),
    device: str = Form("auto"),
):
    """분리 후 파일 경로·길이만 JSON으로 반환 (대용량 응답 대신 메타 확인용)."""
    fmt = format.lower().strip()
    suffix = Path(audio.filename or "input.bin").suffix or ".wav"
    work_root = Path(tempfile.mkdtemp(prefix="vr-json-"))
    try:
        local_in = work_root / f"input{suffix}"
        local_in.write_bytes(await audio.read())
        out_dir = work_root / "out"
        result = separate_audio(local_in, out_dir, output_format=fmt, device=device)
        return JSONResponse(
            {
                "ok": True,
                "instrumental": str(result["instrumental_path"]),
                "vocals": str(result["vocals_path"]),
                "durationSec": result.get("duration_sec", 0),
                "format": fmt,
            }
        )
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


def _guess_media(fmt: str) -> str:
    return {
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "flac": "audio/flac",
    }.get(fmt, "application/octet-stream")


def main() -> None:
    import uvicorn

    print(f"[vocal-remover] local AI server http://{HOST}:{PORT}", flush=True)
    print(f"[vocal-remover] POST /separate  (INFOTOOLS_MOCK_AI={os.environ.get('INFOTOOLS_MOCK_AI', '0')})", flush=True)
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
