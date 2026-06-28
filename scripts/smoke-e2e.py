"""Quick E2E smoke test for mock-infra vocal-remover."""

import json
import sys
import uuid
import urllib.request
from pathlib import Path

BASE = "http://127.0.0.1:19427"
wav = Path(__file__).resolve().parents[1] / "data" / "test-sample.wav"
wav.parent.mkdir(parents=True, exist_ok=True)
wav.write_bytes(
    bytes(
        [
            0x52,
            0x49,
            0x46,
            0x46,
            0x24,
            0,
            0,
            0,
            0x57,
            0x41,
            0x56,
            0x45,
            0x66,
            0x6D,
            0x74,
            0x20,
            0x10,
            0,
            0,
            0,
            1,
            0,
            1,
            0,
            0x44,
            0xAC,
            0,
            0,
            0x88,
            0x58,
            1,
            0,
            2,
            0,
            0x10,
            0,
            0x64,
            0x61,
            0x74,
            0x61,
            0,
            0,
            0,
            0,
        ]
    )
)

boundary = uuid.uuid4().hex
parts = [
    f"--{boundary}\r\n".encode(),
    b'Content-Disposition: form-data; name="file"; filename="test.wav"\r\n',
    b"Content-Type: audio/wav\r\n\r\n",
    wav.read_bytes(),
    f"\r\n--{boundary}--\r\n".encode(),
]
data = b"".join(parts)
req = urllib.request.Request(
    f"{BASE}/api/storage/upload?prefix=vocal-remover/input",
    data=data,
    method="POST",
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
)
up = json.loads(urllib.request.urlopen(req).read())
print("upload:", up)

job_req = urllib.request.Request(
    f"{BASE}/v2/vocal-remover/runsync",
    data=json.dumps({"input": {"audioKey": up["key"], "format": "wav", "device": "cpu"}}).encode(),
    method="POST",
    headers={"Content-Type": "application/json"},
)
job = json.loads(urllib.request.urlopen(job_req, timeout=120).read())
print("job:", json.dumps(job, indent=2))
if job.get("status") != "COMPLETED":
    sys.exit(1)
out = job.get("output") or {}
for k in ("instrumentalUrl", "vocalsUrl"):
    url = out.get(k)
    if not url:
        print(f"missing {k}")
        sys.exit(1)
    urllib.request.urlopen(url, timeout=30).read()
    print(f"ok {k}")
print("E2E OK")
