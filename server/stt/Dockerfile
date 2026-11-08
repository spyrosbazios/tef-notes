# Speech to text (app.py): Parakeet TDT 0.6B v2 on the CPU. Context: the repo root, like the agent's; allowlist:
# Dockerfile.dockerignore beside this file. The model downloads into /data (a volume) on first use, not into the image.
FROM python:3.13-slim
WORKDIR /app
COPY server/stt/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY server/stt/app.py ./
RUN useradd -u 1000 -m stt && mkdir /data && chown stt:stt /data
USER stt
ENV TEF_NOTES_DATA=/data PORT=8099 HF_HUB_DISABLE_TELEMETRY=1 PYTHONUNBUFFERED=1
EXPOSE 8099
CMD ["python", "-I", "app.py"]
