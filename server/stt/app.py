"""Speech to text: NVIDIA Parakeet TDT 0.6B v3 (25 European languages, Greek and English among them), int8, on the CPU,
through onnx-asr.

Reached only by the agent (server/agent/src/transcribe.ts) on the compose network; never published. Holds nothing: a
clip is transcribed in memory and dropped. The clients send a recording in pieces cut at pauses as it is spoken
(packages/core/src/voice.ts `cutOf`), so a clip is rarely over 20 s. The model (~670 MB on disk, ~1.4 GB resident) is loaded on the first request
in a worker process, and unloaded (the process ended) once it has sat idle for the `keep` seconds the last request asked for (the owner's setting, prefs.ts
`voice.keep`): 0 unloads it as soon as the clip is done.

  POST /warm?keep=S        load now (the mic was pressed), so the clip that follows waits for no load
  POST /transcribe?keep=S  body: mono 16 kHz little-endian float32 PCM -> {"text": "..."}
  GET  /status             {"loaded": bool}
"""

import json
import multiprocessing as mp
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
import onnx_asr
import onnxruntime as ort
from huggingface_hub import snapshot_download

#: Parakeet TDT 0.6B v3 as onnx-asr loads it, int8, pinned to a commit. Measured on the N100 (2026-11-11) against the
#: TDT_CTC 110M it replaced: as fast at 2 threads (real-time factor ~0.22: 10 s of speech in ~2.2 s), fewer dropped
#: words, multilingual; ~1.4 GB resident against ~1.1 GB.
MODEL = "istupakov/parakeet-tdt-0.6b-v3-onnx"
REVISION = "8f23f0c03c8761650bdb5b40aaf3e40d2c15f1ce"
FILES = ["config.json", "vocab.txt", "nemo128.onnx", "encoder-model.int8.onnx", "decoder_joint-model.int8.onnx"]
#: Threads per clip: measured on the 4-core N100, 2 beat 4 (and 1, and 3), since the other cores are busy with the rest of
#: the host.
THREADS = 2
DATA = os.environ.get("TEF_NOTES_DATA", "/data")
RATE = 16_000
#: The longest clip taken: ten minutes of float32 at 16 kHz.
MAX_BYTES = 10 * 60 * RATE * 4
#: Clips up to this many seconds go to the model whole; longer ones are cut by the VAD first.
SHORT = 25
#: The longest a model may be kept idle (the setting's top), an hour.
MAX_KEEP = 3600

lock = threading.Lock()  # one clip at a time: the model uses every core anyway
worker = None  # (process, pipe) holding the model, or None
idle_until = 0.0


def keep_of(q: dict) -> int:
    try:
        return max(0, min(MAX_KEEP, int(q.get("keep", ["300"])[0])))
    except ValueError:
        return 300


def serve(conn):
    """The worker: loads the model (downloaded once into the data volume), then transcribes what it is sent. A process of
    its own because freeing a model inside one leaves its memory with the allocator: killing the process gives it back."""
    t = time.monotonic()
    path = snapshot_download(MODEL, revision=REVISION, allow_patterns=FILES, local_dir=os.path.join(DATA, "parakeet-0.6b-v3"))
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = THREADS
    asr = onnx_asr.load_model("nemo-conformer-tdt", path, quantization="int8", sess_options=opts)
    vad = onnx_asr.load_vad("silero", os.path.join(DATA, "silero"))
    long = asr.with_vad(vad)
    # The first runs set onnxruntime up for a clip's length (~2-4 s): do them now, on 10 s of faint noise (silence is cut
    # short), not on the first clip
    noise = np.random.default_rng(0).normal(0, 0.01, 10 * RATE).astype(np.float32)
    for _ in range(2):
        asr.recognize(noise, sample_rate=RATE)
    print(f"stt: loaded {MODEL} in {time.monotonic() - t:.1f}s", flush=True)
    conn.send(None)
    while True:
        pcm = conn.recv()
        try:
            if pcm.size <= SHORT * RATE:
                text = asr.recognize(pcm, sample_rate=RATE).strip()
            else:  # Parakeet takes ~20-30 s at a time: the VAD cuts a longer clip at its pauses
                text = " ".join(s.text.strip() for s in long.recognize(pcm, sample_rate=RATE) if s.text.strip())
            conn.send(text)
        except Exception as e:  # noqa: BLE001 - reported to the caller, the worker lives on
            conn.send(e)


def load():
    """The worker's pipe, started if it is not. Called under `lock`."""
    global worker
    if worker is None or not worker[0].is_alive():
        parent, child = mp.Pipe()
        proc = mp.Process(target=serve, args=(child,), daemon=True)
        proc.start()
        child.close()  # only the worker holds that end now: if it dies, recv() raises instead of waiting forever
        try:
            parent.recv()  # loaded
        except EOFError:
            proc.join()
            raise RuntimeError(f"the model failed to load (worker exit code {proc.exitcode})") from None
        worker = (proc, parent)
    return worker[1]


def unload():
    global worker
    if worker is not None:
        worker[0].kill()
        worker[0].join()
        worker = None
        print("stt: unloaded (idle)", flush=True)


def touch(keep: int):
    global idle_until
    idle_until = time.monotonic() + keep
    if keep == 0:
        unload()


def reaper():
    """Unloads the model once its idle time has passed."""
    while True:
        time.sleep(1)
        with lock:
            if worker is not None and time.monotonic() >= idle_until:
                unload()


def transcribe(pcm: np.ndarray) -> str:
    if pcm.size < RATE // 4:  # under a quarter second: nothing said
        return ""
    pipe = load()
    pipe.send(pcm)
    try:
        out = pipe.recv()
    except EOFError:  # the worker died mid-clip (out of memory): start a fresh one next time
        unload()
        raise RuntimeError("the worker died transcribing") from None
    if isinstance(out, Exception):
        raise out
    return out


class Handler(BaseHTTPRequestHandler):
    def reply(self, status: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path == "/status":
            return self.reply(200, {"loaded": worker is not None})
        self.reply(404, {"error": "not found"})

    def do_POST(self):
        url = urlparse(self.path)
        keep = keep_of(parse_qs(url.query))
        if url.path == "/warm":
            with lock:
                try:
                    load()
                except Exception as e:  # noqa: BLE001
                    print(f"stt: failed: {e}", flush=True)
                    return self.reply(500, {"error": "the model failed to load"})
                touch(keep)
            return self.reply(200, {"loaded": True})
        if url.path != "/transcribe":
            return self.reply(404, {"error": "not found"})
        size = int(self.headers.get("Content-Length") or 0)
        if size > MAX_BYTES:
            return self.reply(413, {"error": "the recording is longer than ten minutes"})
        if size % 4:
            return self.reply(400, {"error": "the body is not float32 samples"})
        pcm = np.frombuffer(self.rfile.read(size), dtype="<f4").astype(np.float32)
        t = time.monotonic()
        with lock:
            try:
                text = transcribe(pcm)
            except Exception as e:  # noqa: BLE001
                print(f"stt: failed: {e}", flush=True)
                return self.reply(500, {"error": "transcription failed"})
            finally:
                touch(keep)
        print(f"stt: {pcm.size / RATE:.1f}s of audio in {time.monotonic() - t:.1f}s", flush=True)
        self.reply(200, {"text": text})

    def log_message(self, *_):  # the access log would be one line per clip; the timing line above says more
        pass


if __name__ == "__main__":
    mp.set_start_method("spawn")  # a clean worker: no copy of the server's threads or lock
    threading.Thread(target=reaper, daemon=True).start()
    port = int(os.environ.get("PORT", "8099"))
    print(f"stt: listening on {port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
