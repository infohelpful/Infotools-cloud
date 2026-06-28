#!/usr/bin/env node
/**
 * Docker 로컬 AI 서버에 오디오 보내서 분리 결과 저장
 *
 *   npm run docker:test:vocal-remover
 *   npm run docker:test:vocal-remover -- path/to/song.mp3
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.INFOTOOLS_LOCAL_PORT || "8000";
const base = `http://127.0.0.1:${port}`;
const audioArg = process.argv[2];
const outDir = path.join(root, "data", "docker-test-output");

function minimalWav() {
  return Buffer.from([
    0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20, 0x10, 0, 0,
    0, 1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 0x10, 0, 0x64, 0x61, 0x74, 0x61, 0, 0, 0, 0,
  ]);
}

async function waitHealth(maxSec = 120) {
  const started = Date.now();
  while (Date.now() - started < maxSec * 1000) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) {
        const j = await res.json();
        console.log("health:", j);
        return;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`server not ready at ${base}/health — run: npm run docker:run:vocal-remover`);
}

function multipartBody(filePath, fields) {
  const boundary = `----infotools${Date.now()}`;
  const chunks = [];
  const filename = path.basename(filePath);
  const fileData = fs.readFileSync(filePath);

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
    );
  }
  chunks.push(
    `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const header = Buffer.from(chunks.join(""));
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    body: Buffer.concat([header, fileData, footer]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function postSeparate(filePath, stem, outPath) {
  const { body, contentType } = multipartBody(filePath, {
    stem,
    format: path.extname(outPath).slice(1) || "wav",
    device: process.env.DEMUCS_DEVICE || "auto",
  });
  const res = await fetch(`${base}/separate`, { method: "POST", headers: { "Content-Type": contentType }, body });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`separate failed: ${res.status} ${t}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, buf);
  console.log(`saved: ${outPath} (${buf.length} bytes)`);
}

async function main() {
  let audioPath = audioArg;
  if (!audioPath) {
    const sample = path.join(root, "data", "docker-test-sample.wav");
    fs.mkdirSync(path.dirname(sample), { recursive: true });
    fs.writeFileSync(sample, minimalWav());
    audioPath = sample;
    console.log(`no audio arg — using minimal sample: ${audioPath}`);
    console.log("tip: npm run docker:test:vocal-remover -- C:\\path\\to\\song.mp3");
  } else {
    audioPath = path.resolve(audioPath);
    if (!fs.existsSync(audioPath)) throw new Error(`file not found: ${audioPath}`);
  }

  await waitHealth();
  fs.mkdirSync(outDir, { recursive: true });

  const ext = path.extname(audioPath).slice(1) || "wav";
  const vocalOut = path.join(outDir, `vocals.${ext === "mp3" ? "mp3" : "wav"}`);
  const mrOut = path.join(outDir, `instrumental.${ext === "mp3" ? "mp3" : "wav"}`);

  console.log("separating vocals...");
  await postSeparate(audioPath, "vocals", vocalOut);
  console.log("separating instrumental...");
  await postSeparate(audioPath, "instrumental", mrOut);

  console.log("Docker AI test OK");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
