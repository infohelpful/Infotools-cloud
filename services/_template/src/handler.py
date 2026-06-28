"""RunPod handler template — replace run_job body."""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

_SRC = Path(__file__).resolve().parent
_REPO_ROOT = _SRC.parents[2]
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))
if str(_REPO_ROOT / "libs" / "py") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "libs" / "py"))

from infotools.storage import storage_client_from_env  # noqa: E402

SERVICE_ID = "__SERVICE_ID__"


def run_job(job_input: dict) -> dict:
    # TODO: implement
    return {"jobId": job_input.get("jobId") or str(uuid.uuid4()), "status": "ok"}


def handler(event: dict) -> dict:
    inp = event.get("input") if isinstance(event.get("input"), dict) else event
    return run_job(inp or {})


if __name__ == "__main__":
    if os.environ.get("RUNPOD_SERVERLESS", "").lower() in {"1", "true", "yes"}:
        import runpod  # type: ignore

        runpod.serverless.start({"handler": handler})
    else:
        print(json.dumps(run_job({}), indent=2))
