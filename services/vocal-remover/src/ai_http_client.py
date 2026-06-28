"""로컬 Docker/HTTP AI 서버(local_server)로 분리 요청."""

from __future__ import annotations

import json
import os
import uuid
import urllib.error
import urllib.request
import zipfile
from pathlib import Path


def _multipart_body(fields: dict[str, str], file_field: str, file_path: Path) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    suffix = file_path.suffix or ".wav"
    upload_name = file_path.name if file_path.suffix else f"audio{suffix}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        parts.append(f"{value}\r\n".encode())
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(
        f'Content-Disposition: form-data; name="{file_field}"; filename="{upload_name}"\r\n'.encode()
    )
    parts.append(b"Content-Type: application/octet-stream\r\n\r\n")
    parts.append(file_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    return body, f"multipart/form-data; boundary={boundary}"


def separate_via_http(
    server_url: str,
    input_path: Path,
    work_dir: Path,
    *,
    output_format: str = "wav",
    device: str = "auto",
    timeout_sec: float = 3600.0,
) -> dict[str, object]:
    base = server_url.rstrip("/")
    work_dir.mkdir(parents=True, exist_ok=True)
    body, ct = _multipart_body(
        {
            "stem": "both",
            "format": output_format,
            "device": str(device),
        },
        "audio",
        input_path,
    )
    req = urllib.request.Request(
        f"{base}/separate",
        data=body,
        method="POST",
        headers={"Content-Type": ct},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            data = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:2000]
        raise RuntimeError(f"AI server error {exc.code}: {detail}") from exc

    zip_path = work_dir / "stems.zip"
    zip_path.write_bytes(data)
    extract_dir = work_dir / "extracted"
    extract_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(extract_dir)

    inst = extract_dir / f"instrumental.{output_format}"
    voc = extract_dir / f"vocals.{output_format}"
    if not inst.is_file() or not voc.is_file():
        found = list(extract_dir.rglob("*"))
        raise RuntimeError(f"AI server zip missing stems; got: {[p.name for p in found]}")

    return {
        "instrumental_path": inst,
        "vocals_path": voc,
        "duration_sec": 0.0,
    }


def ai_server_url_from_env() -> str:
    return os.environ.get("INFOTOOLS_AI_SERVER_URL", "").strip()
