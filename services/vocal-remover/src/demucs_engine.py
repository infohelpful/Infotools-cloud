"""Demucs in-process separation — avoids torchaudio/torchcodec save crash."""

from __future__ import annotations

import os
from pathlib import Path

import torch

from demucs.apply import BagOfModels, apply_model
from demucs.audio import AudioFile, convert_audio, prevent_clip
from demucs.htdemucs import HTDemucs
from demucs.pretrained import get_model


def _model_name() -> str:
    return os.environ.get("INFOTOOLS_DEMUCS_MODEL", "mdx_extra_q").strip() or "mdx_extra_q"


def _segment_for_model(model, device: str) -> float | None:
    max_allowed = float("inf")
    if isinstance(model, HTDemucs):
        max_allowed = float(model.segment)
    elif isinstance(model, BagOfModels):
        max_allowed = float(model.max_allowed_segment)

    raw = os.environ.get("INFOTOOLS_DEMUCS_SEGMENT", "").strip()
    if raw:
        seg = float(raw)
    elif device == "cpu" and max_allowed < float("inf"):
        seg = max_allowed
    else:
        return None

    if seg > max_allowed:
        seg = max_allowed
    return seg


def _save_wav_soundfile(wav: torch.Tensor, path: Path, samplerate: int) -> None:
    import soundfile as sf

    path.parent.mkdir(parents=True, exist_ok=True)
    tensor = prevent_clip(wav, mode="rescale")
    arr = tensor.detach().cpu().numpy()
    if arr.ndim == 2:
        arr = arr.T
    sf.write(str(path), arr, samplerate, subtype="PCM_16")


def separate_demucs_two_stems(
    input_wav: Path,
    output_dir: Path,
    *,
    device: str = "cpu",
    stem: str = "vocals",
    on_progress=None,
) -> tuple[Path, Path]:
    """
    Returns (instrumental/no_vocals path, vocals path).
    """
    model = get_model(_model_name())
    model.cpu()
    model.eval()

    if stem not in model.sources:
        raise RuntimeError(f"stem {stem!r} not in model sources: {model.sources}")

    segment = _segment_for_model(model, device)
    output_dir.mkdir(parents=True, exist_ok=True)

    wav = AudioFile(input_wav).read(
        streams=0,
        samplerate=model.samplerate,
        channels=model.audio_channels,
    )
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / ref.std()

    sources = apply_model(
        model,
        wav[None],
        device=device,
        shifts=1,
        split=True,
        overlap=0.25,
        progress=on_progress is not None,
        num_workers=0,
        segment=segment,
    )[0]
    sources = sources * ref.std() + ref.mean()

    sources_list = list(sources)
    vocals = sources_list.pop(model.sources.index(stem))
    instrumental = torch.zeros_like(sources_list[0])
    for part in sources_list:
        instrumental += part

    track = input_wav.stem
    voc_path = output_dir / f"{track}_vocals.wav"
    inst_path = output_dir / f"{track}_no_{stem}.wav"
    _save_wav_soundfile(vocals, voc_path, model.samplerate)
    _save_wav_soundfile(instrumental, inst_path, model.samplerate)
    return inst_path, voc_path
