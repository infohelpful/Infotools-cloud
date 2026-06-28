"""Demucs stem separation — cloud handler (no local agent deps)."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

from demucs_engine import _model_name as _demucs_model_name  # noqa: E402

MODEL_NAME = _demucs_model_name()
SUPPORTED_FORMATS = {"wav", "mp3", "flac"}
_TQDM_RE = re.compile(r"^\s*\d+%\|")


def _run(cmd: list[str], *, timeout: float = 3600.0, cwd: Path | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=str(cwd) if cwd else None,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )


def _ffmpeg_path() -> str:
    return os.environ.get("FFMPEG_PATH", "ffmpeg")


def _ffprobe_duration(path: Path) -> float:
    proc = _run(
        [
            _ffmpeg_path().replace("ffmpeg", "ffprobe")
            if "ffmpeg" in _ffmpeg_path()
            else "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        timeout=30,
    )
    if proc.returncode != 0:
        return 0.0
    try:
        return float((proc.stdout or "").strip())
    except ValueError:
        return 0.0


def _resolve_device(device: str | None) -> str:
    if not device or device == "auto":
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
        except Exception:
            pass
        return "cpu"
    d = device.lower()
    if d not in {"cpu", "cuda"}:
        raise ValueError("device must be auto, cpu, or cuda")
    return d


def _export_format(stem_wav: Path, output_format: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if output_format == "wav":
        shutil.copy2(stem_wav, dest)
        return dest
    proc = _run(
        [_ffmpeg_path(), "-y", "-i", str(stem_wav), str(dest)],
        timeout=300,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr or proc.stdout}")
    return dest


def _demucs_output_matches(stem: str, selected: str) -> bool:
    s = stem.lower()
    key = selected.lower()
    if key == "vocals":
        if "no_vocals" in s or "no-vocals" in s:
            return False
        return "vocals" in s
    if key == "no_vocals":
        return "no_vocals" in s or "no-vocals" in s
    return key in s


def _find_output(output_dir: Path, input_stem: str, stem_type: str) -> Path | None:
    wavs = list(output_dir.rglob("*.wav"))
    cands = [p for p in wavs if input_stem in p.stem and _demucs_output_matches(p.stem, stem_type)]
    if not cands:
        cands = [p for p in wavs if _demucs_output_matches(p.stem, stem_type)]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def _demucs_error_tail(stdout: str, stderr: str, limit: int = 3500) -> str:
    lines = (stderr + "\n" + stdout).splitlines()
    kept = [
        ln
        for ln in lines
        if ln.strip()
        and not _TQDM_RE.match(ln)
        and "seconds/s" not in ln
        and "|" not in ln[:8]
    ]
    if not kept:
        kept = lines[-40:]
    text = "\n".join(kept).strip()
    return text[-limit:] if len(text) > limit else text


def _normalize_for_demucs(input_path: Path, work_dir: Path) -> Path:
    """ffmpeg으로 wav 정규화 — 확장자 없음/mp3 등 Demucs 실패 방지."""
    dest = work_dir / "demucs_input.wav"
    proc = _run(
        [
            _ffmpeg_path(),
            "-y",
            "-i",
            str(input_path),
            "-ar",
            "44100",
            "-ac",
            "2",
            str(dest),
        ],
        timeout=600,
    )
    if proc.returncode != 0:
        detail = _demucs_error_tail(proc.stdout or "", proc.stderr or "", 1500)
        raise RuntimeError(f"ffmpeg 입력 변환 실패: {detail}")
    if not dest.is_file() or dest.stat().st_size < 44:
        raise RuntimeError("ffmpeg 출력이 비어 있습니다")
    return dest


def _mock_separate(input_path: Path, work_dir: Path) -> tuple[Path, Path]:
    """Dev fallback when demucs/torch unavailable."""
    time.sleep(2)
    inst = work_dir / "mock_instrumental.wav"
    voc = work_dir / "mock_vocals.wav"
    shutil.copy2(input_path, inst)
    shutil.copy2(input_path, voc)
    return inst, voc


def separate_audio(
    input_path: Path,
    work_dir: Path,
    *,
    output_format: str = "wav",
    device: str | None = "auto",
    on_progress: Callable[[float, str], None] | None = None,
) -> dict[str, object]:
    if output_format not in SUPPORTED_FORMATS:
        raise ValueError(f"unsupported format: {output_format}")
    if not input_path.is_file():
        raise FileNotFoundError(str(input_path))

    work_dir.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time() * 1000)

    def report(pct: float, msg: str) -> None:
        if on_progress:
            on_progress(pct, msg)

    report(5, "preparing separation")
    device_resolved = _resolve_device(device)
    output_dir = work_dir / f"demucs-out-{stamp}"
    output_dir.mkdir(parents=True, exist_ok=True)

    use_mock = os.environ.get("INFOTOOLS_MOCK_AI", "").strip().lower() in {"1", "true", "yes"}
    if not use_mock:
        try:
            import demucs  # noqa: F401
        except ImportError as exc:
            raise RuntimeError(
                "Demucs가 설치되어 있지 않습니다. "
                "pip install -r services/vocal-remover/requirements.txt 또는 Docker AI 서버를 사용하세요."
            ) from exc

    if use_mock:
        report(20, "mock separation (set demucs or unset INFOTOOLS_MOCK_AI)")
        inst_wav, voc_wav = _mock_separate(input_path, work_dir)
    else:
        report(10, "normalizing audio (ffmpeg)")
        demucs_in = _normalize_for_demucs(input_path, work_dir)
        report(15, f"running demucs {MODEL_NAME} ({device_resolved})")

        from demucs_engine import separate_demucs_two_stems

        def _tqdm_progress(*_args, **_kwargs):
            report(50, f"demucs processing ({device_resolved})")

        inst_src, voc_src = separate_demucs_two_stems(
            demucs_in,
            output_dir,
            device=device_resolved,
            stem="vocals",
            on_progress=_tqdm_progress,
        )
        report(85, "collecting stems")
        inst_wav = work_dir / f"demucs_input-{stamp}-mr.wav"
        voc_wav = work_dir / f"demucs_input-{stamp}-vocals.wav"
        shutil.copy2(inst_src, inst_wav)
        shutil.copy2(voc_src, voc_wav)

    report(92, "exporting formats")
    inst_out = work_dir / f"{input_path.stem}-{stamp}-mr.{output_format}"
    voc_out = work_dir / f"{input_path.stem}-{stamp}-vocals.wav"
    _export_format(inst_wav, output_format, inst_out)
    if output_format != "wav":
        voc_export = work_dir / f"{input_path.stem}-{stamp}-vocals.{output_format}"
        _export_format(voc_wav, output_format, voc_export)
    else:
        voc_export = voc_wav

    duration = _ffprobe_duration(input_path)
    report(100, "done")
    return {
        "instrumental_path": inst_out,
        "vocals_path": voc_export,
        "duration_sec": duration,
    }
