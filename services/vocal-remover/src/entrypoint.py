"""Container entry: local HTTP server | RunPod serverless | CLI."""

from __future__ import annotations

import os
import sys
from pathlib import Path

_SRC = Path(__file__).resolve().parent
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))


def _truthy(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def main() -> None:
    if _truthy("INFOTOOLS_LOCAL_SERVER"):
        from local_server import main as run_local

        run_local()
        return

    if _truthy("RUNPOD_SERVERLESS"):
        from handler import handler

        import runpod  # type: ignore

        runpod.serverless.start({"handler": handler})
        return

    from handler import main as run_cli

    run_cli()


if __name__ == "__main__":
    main()
