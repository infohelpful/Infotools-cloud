FROM pytorch/pytorch:2.2.2-cuda12.1-cudnn8-runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

COPY services/vocal-remover/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

# Demucs 가중치(mdx_extra_q) — 빌드 시 미리 받으면 첫 실행이 빠름 (선택)
ARG PRELOAD_DEMUCS_MODEL=0
RUN if [ "$PRELOAD_DEMUCS_MODEL" = "1" ]; then \
      python -c "from demucs.pretrained import get_model; get_model('mdx_extra_q')"; \
    fi

COPY services/vocal-remover/src/ /app/src/
COPY libs/py/infotools/ /app/libs/py/infotools/

ENV PYTHONPATH=/app/src:/app/libs/py
ENV INFOTOOLS_MOCK_AI=0

# RunPod 배포 시 -e RUNPOD_SERVERLESS=1
# 로컬 AI 검증 시 -e INFOTOOLS_LOCAL_SERVER=1
EXPOSE 8000

CMD ["python", "-u", "/app/src/entrypoint.py"]
