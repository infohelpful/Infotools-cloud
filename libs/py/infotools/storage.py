"""Shared storage helpers (mock local + future R2)."""

from __future__ import annotations

import mimetypes
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

_SAFE_KEY = re.compile(r"[^a-zA-Z0-9/_.\-]+")


def sanitize_storage_key(key: str) -> str:
    key = key.replace("\\", "/").strip().lstrip("/")
    if ".." in key.split("/"):
        raise ValueError("invalid storage key")
    return _SAFE_KEY.sub("_", key)


def object_path(root: Path, key: str) -> Path:
    safe = sanitize_storage_key(key)
    path = (root / safe).resolve()
    root_resolved = root.resolve()
    if not str(path).startswith(str(root_resolved)):
        raise ValueError("storage key escapes root")
    return path


def guess_content_type(path: Path) -> str:
    ct, _ = mimetypes.guess_type(str(path))
    return ct or "application/octet-stream"


class MockStorageClient:
    """HTTP client for mock-infra storage API."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def upload_file(self, key: str, file_path: Path, content_type: str | None = None) -> str:
        safe_key = sanitize_storage_key(key)
        ct = content_type or guess_content_type(file_path)
        url = f"{self.base_url}/api/storage/object/{urllib.parse.quote(safe_key, safe='')}"
        data = file_path.read_bytes()
        req = urllib.request.Request(
            url,
            data=data,
            method="PUT",
            headers={"Content-Type": ct},
        )
        with urllib.request.urlopen(req, timeout=600) as resp:
            resp.read()
        return safe_key

    def download_file(self, key: str, dest: Path) -> Path:
        safe_key = sanitize_storage_key(key)
        url = f"{self.base_url}/api/storage/object/{urllib.parse.quote(safe_key, safe='')}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=600) as resp:
            dest.write_bytes(resp.read())
        return dest

    def public_url(self, key: str) -> str:
        safe_key = sanitize_storage_key(key)
        return f"{self.base_url}/api/storage/object/{urllib.parse.quote(safe_key, safe='')}"


class LocalFilesystemStorageClient:
    """Direct disk access — avoids HTTP deadlock when handler runs inside mock-infra."""

    def __init__(self, root: Path, public_base_url: str) -> None:
        self.root = root
        self.public_base_url = public_base_url.rstrip("/")

    def upload_file(self, key: str, file_path: Path, content_type: str | None = None) -> str:
        safe_key = sanitize_storage_key(key)
        dest = object_path(self.root, safe_key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(file_path.read_bytes())
        return safe_key

    def download_file(self, key: str, dest: Path) -> Path:
        safe_key = sanitize_storage_key(key)
        src = object_path(self.root, safe_key)
        if not src.is_file():
            raise FileNotFoundError(safe_key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(src.read_bytes())
        return dest

    def public_url(self, key: str) -> str:
        safe_key = sanitize_storage_key(key)
        return f"{self.public_base_url}/api/storage/object/{urllib.parse.quote(safe_key, safe='')}"


def storage_client_from_env():
    provider = os.environ.get("INFOTOOLS_STORAGE_PROVIDER", "").strip().lower()
    if provider == "r2" or os.environ.get("R2_ACCESS_KEY_ID", "").strip():
        from infotools.r2 import R2StorageClient

        return R2StorageClient.from_env()

    root = os.environ.get("INFOTOOLS_MOCK_R2_ROOT", "").strip()
    base = os.environ.get("INFOTOOLS_PUBLIC_BASE_URL", "http://127.0.0.1:19427").strip()
    if root:
        return LocalFilesystemStorageClient(Path(root), base)
    return MockStorageClient(base)
