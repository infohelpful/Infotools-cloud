"""Verify RunPod API key encryption and proxy integration."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "mock-infra"))

from main import (  # noqa: E402
    ADMIN_STATE_PATH,
    MOCK_ADMIN_TOKEN,
    _admin_state,
    _save_admin_state,
    decrypt_val,
    encrypt_val,
)
from runpod_proxy import proxy_runpod, resolve_runpod_endpoint, runpod_api_key, uses_runpod_proxy  # noqa: E402

TEST_KEY = "r8_test_verification_key_12345"
PORT = 19427
BASE = f"http://127.0.0.1:{PORT}"


def check(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    suffix = f" - {detail}" if detail else ""
    print(f"[{status}] {name}{suffix}")
    if not ok:
        raise SystemExit(1)


def test_encrypt_roundtrip() -> None:
    enc = encrypt_val(TEST_KEY)
    check("encrypt format", enc.startswith("enc:") and enc.count(":") == 2, enc[:40] + "...")
    dec = decrypt_val(enc)
    check("decrypt roundtrip", dec == TEST_KEY)


def test_admin_state_persistence() -> None:
    state = _admin_state()
    state["runpodApiKey"] = TEST_KEY
    _save_admin_state(state)

    raw = json.loads(ADMIN_STATE_PATH.read_text(encoding="utf-8"))
    stored = raw.get("runpodApiKey", "")
    check("admin-state.json has runpodApiKey", "runpodApiKey" in raw)
    check("stored value encrypted", stored.startswith("enc:"), stored[:48] + "...")
    check("stored value not plaintext", TEST_KEY not in stored)

    loaded = _admin_state()
    check("reload decrypted value", loaded.get("runpodApiKey") == TEST_KEY)


def test_http_admin_roundtrip() -> None:
    payload = json.dumps({"runpodApiKey": TEST_KEY}).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE}/api/admin/state",
        data=payload,
        headers={
            "Authorization": f"Bearer {MOCK_ADMIN_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.URLError as exc:
        check("mock-infra server reachable", False, str(exc))
        return

    check("POST /api/admin/state returns decrypted key", body.get("runpodApiKey") == TEST_KEY)

    get_req = urllib.request.Request(
        f"{BASE}/api/admin/state",
        headers={"Authorization": f"Bearer {MOCK_ADMIN_TOKEN}"},
    )
    with urllib.request.urlopen(get_req, timeout=10) as resp:
        loaded = json.loads(resp.read().decode("utf-8"))
    check("GET /api/admin/state reload", loaded.get("runpodApiKey") == TEST_KEY)


def test_runpod_proxy_uses_admin_key() -> None:
    state = _admin_state()
    state["activeEnvironment"] = "staging"
    state["runpodApiKey"] = TEST_KEY
    check("staging uses runpod proxy", uses_runpod_proxy(state))
    check("endpoint resolved", resolve_runpod_endpoint(state, "vocal-remover").startswith("https://"))
    check("api key from admin state", runpod_api_key(state) == TEST_KEY)

    captured = {}

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return json.dumps({"id": "job-1", "status": "IN_QUEUE"}).encode("utf-8")

    def fake_urlopen(req, timeout=120):
        captured["url"] = req.full_url
        captured["authorization"] = req.headers.get("Authorization")
        captured["method"] = req.method
        return FakeResponse()

    with patch("runpod_proxy.urllib.request.urlopen", fake_urlopen):
        status, payload = proxy_runpod(
            state,
            "vocal-remover",
            "/run",
            method="POST",
            body=b'{"input":{}}',
        )

    check("proxy status ok", status == 200)
    check("proxy forwards bearer key", captured.get("authorization") == f"Bearer {TEST_KEY}")
    check("proxy targets staging endpoint", "api.runpod.ai" in captured.get("url", ""))


def test_local_mock_still_local() -> None:
    state = _admin_state()
    state["activeEnvironment"] = "local-mock"
    check("local-mock bypasses runpod proxy", not uses_runpod_proxy(state))


def main() -> None:
    print("=== RunPod API Key verification ===")
    test_encrypt_roundtrip()
    test_admin_state_persistence()
    test_runpod_proxy_uses_admin_key()
    test_local_mock_still_local()
    test_http_admin_roundtrip()
    print("\nAll checks passed.")


if __name__ == "__main__":
    main()
