"""RunPod API proxy using admin-stored credentials."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


def uses_runpod_proxy(state: dict) -> bool:
    env_id = state.get("activeEnvironment", "local-mock")
    env = (state.get("environments") or {}).get(env_id) or {}
    inf = env.get("inference") or {}
    provider = inf.get("provider", "")
    mode = inf.get("mode", "")
    if provider == "mock-runpod" or mode == "direct":
        return False
    return provider == "runpod" or mode == "edge-proxy"


def resolve_runpod_endpoint(state: dict, service_id: str) -> str:
    env_id = state.get("activeEnvironment", "local-mock")
    env = (state.get("environments") or {}).get(env_id) or {}
    endpoints = (env.get("inference") or {}).get("endpoints") or {}
    return str(endpoints.get(service_id, "")).rstrip("/")


def runpod_api_key(state: dict) -> str:
    return str(state.get("runpodApiKey", "")).strip()


def proxy_runpod(
    state: dict,
    service_id: str,
    path_suffix: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
) -> tuple[int, dict[str, Any] | str]:
    endpoint = resolve_runpod_endpoint(state, service_id)
    api_key = runpod_api_key(state)
    if not endpoint:
        return 503, {"error": f"no RunPod endpoint for {service_id}"}
    if not api_key:
        return 503, {"error": "RUNPOD_API_KEY not configured"}

    url = f"{endpoint}{path_suffix}"
    headers = {"Authorization": f"Bearer {api_key}"}
    if body is not None:
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=body, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, {"error": raw or exc.reason}
    except urllib.error.URLError as exc:
        return 502, {"error": f"RunPod request failed: {exc.reason}"}
