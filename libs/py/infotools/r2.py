"""Cloudflare R2 (S3-compatible) storage client for RunPod workers."""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import quote

from infotools.storage import guess_content_type, sanitize_storage_key


class R2StorageClient:
    def __init__(
        self,
        *,
        account_id: str,
        access_key_id: str,
        secret_access_key: str,
        bucket: str,
        public_base_url: str,
    ) -> None:
        import boto3

        self.bucket = bucket
        self.public_base_url = public_base_url.rstrip("/")
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
            region_name="auto",
        )

    @classmethod
    def from_env(cls) -> R2StorageClient:
        account_id = os.environ["R2_ACCOUNT_ID"].strip()
        access_key_id = os.environ["R2_ACCESS_KEY_ID"].strip()
        secret_access_key = os.environ["R2_SECRET_ACCESS_KEY"].strip()
        bucket = os.environ["R2_BUCKET"].strip()
        public_base_url = os.environ.get("R2_PUBLIC_BASE_URL", "").strip()
        if not public_base_url:
            public_base_url = os.environ.get("INFOTOOLS_PUBLIC_BASE_URL", "").strip()
        if not public_base_url:
            raise ValueError("R2_PUBLIC_BASE_URL or INFOTOOLS_PUBLIC_BASE_URL required")
        return cls(
            account_id=account_id,
            access_key_id=access_key_id,
            secret_access_key=secret_access_key,
            bucket=bucket,
            public_base_url=public_base_url,
        )

    def upload_file(self, key: str, file_path: Path, content_type: str | None = None) -> str:
        safe_key = sanitize_storage_key(key)
        ct = content_type or guess_content_type(file_path)
        self._client.upload_file(
            str(file_path),
            self.bucket,
            safe_key,
            ExtraArgs={"ContentType": ct},
        )
        return safe_key

    def download_file(self, key: str, dest: Path) -> Path:
        safe_key = sanitize_storage_key(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(self.bucket, safe_key, str(dest))
        return dest

    def public_url(self, key: str) -> str:
        safe_key = sanitize_storage_key(key)
        return f"{self.public_base_url}/{quote(safe_key, safe='/')}"
