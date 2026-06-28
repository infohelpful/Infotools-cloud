#!/usr/bin/env node
/**
 * npm run dev — mock API + AI 서버(Docker/로컬) + Vite 웹 UI 한 번에 기동
 *
 * INFOTOOLS_DEV_AI=auto|docker|local|mock  (기본 auto)
 * INFOTOOLS_DEV_CPU=1  — Docker GPU 없이 CPU만
 */
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { freePort } from "./free-port.mjs";
import { requirePython312, resolvePython } from "./python-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const py = resolvePython(root);

const AI_PORT = process.env.INFOTOOLS_AI_PORT || "8000";
const AI_URL = `http://127.0.0.1:${AI_PORT}`;
const MOCK_PORT = process.env.INFOTOOLS_MOCK_INFRA_PORT || "19427";
const DOCKER_NAME = "infotools-vocal-remover-dev";
const DOCKER_IMAGE = process.env.DOCKER_IMAGE || "infotools/vocal-remover:latest";
const DEV_AI = (process.env.INFOTOOLS_DEV_AI || "auto").toLowerCase();

const children = [];
let aiMode = "mock";

function run(cmd, args, opts = {}) {
  const useShell =
    opts.shell ?? (process.platform === "win32" && (cmd === "npm" || cmd === "docker"));
  const child = spawn(cmd, args, {
    stdio: opts.stdio ?? "inherit",
    shell: useShell,
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    detached: opts.detached ?? false,
  });
  children.push(child);
  return child;
}

function runQuiet(cmd) {
  try {
    execSync(cmd, { cwd: root, stdio: "pipe", shell: true });
    return true;
  } catch {
    return false;
  }
}

function dockerOk() {
  return runQuiet("docker version");
}

function imageExists() {
  try {
    const out = execSync(`docker image inspect ${DOCKER_IMAGE}`, {
      cwd: root,
      stdio: "pipe",
      shell: true,
    });
    return out.length > 0;
  } catch {
    return false;
  }
}

async function waitHealth(url, label, maxSec = 180) {
  const started = Date.now();
  process.stdout.write(`  waiting for ${label}`);
  while (Date.now() - started < maxSec * 1000) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/health`);
      if (res.ok) {
        const j = await res.json();
        const extra =
          j.mockAi !== undefined
            ? `(mockAi=${j.mockAi}, cuda=${j.cudaAvailable}${j.gpuName ? ", " + j.gpuName : ""})`
            : j.devAi?.message
              ? `(${j.devAi.message})`
              : "";
        console.log(`\n  ✓ ${label} ready`, extra);
        return j;
      }
    } catch {
      /* retry */
    }
    process.stdout.write(".");
    await sleep(2000);
  }
  throw new Error(`${label} not ready: ${url}/health`);
}

function validateRealAi(health, label) {
  const mockAi = health.mockAi === true;
  const demucs = health.demucsInstalled;
  if (mockAi) {
    throw new Error(`${label}이 MOCK 모드입니다 (원본 복사만 함). INFOTOOLS_MOCK_AI=0 확인`);
  }
  if (demucs === false) {
    throw new Error(`${label}에 Demucs가 없습니다. Docker 이미지 재빌드 또는 pip install demucs`);
  }
}

function nvidiaAvailable() {
  return runQuiet("nvidia-smi");
}

function torchCudaReady() {
  try {
    const out = execSync(`"${py}" -c "import torch; print('yes' if torch.cuda.is_available() else 'no')"`, {
      encoding: "utf8",
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return out.trim() === "yes";
  } catch {
    return false;
  }
}

function ensureCudaTorch() {
  if (process.env.INFOTOOLS_DEV_CPU === "1") {
    console.log("[dev] INFOTOOLS_DEV_CPU=1 — CPU 모드");
    return;
  }
  if (!nvidiaAvailable()) {
    console.log("[dev] NVIDIA GPU 미감지 — CPU 모드");
    return;
  }
  if (torchCudaReady()) {
    try {
      const name = execSync(
        `"${py}" -c "import torch; print(torch.cuda.get_device_name(0))"`,
        { encoding: "utf8", cwd: root, stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
      console.log(`[dev] PyTorch CUDA OK — ${name}`);
    } catch {
      console.log("[dev] PyTorch CUDA OK");
    }
    return;
  }
  const cuIndex = process.env.INFOTOOLS_TORCH_CUDA_INDEX || "https://download.pytorch.org/whl/cu124";
  console.log(`\n[dev] CPU 전용 torch 감지 — NVIDIA CUDA torch 설치 중 (${cuIndex})...`);
  execSync(`"${py}" -m pip uninstall -y torch torchaudio`, { stdio: "inherit", cwd: root });
  execSync(`"${py}" -m pip install torch torchaudio --index-url ${cuIndex}`, {
    stdio: "inherit",
    cwd: root,
  });
  if (!torchCudaReady()) {
    throw new Error(
      "CUDA torch 미설치. npm run setup 실행 후 다시 시도 (Python 3.12 + NVIDIA CUDA torch)",
    );
  }
}

function ensureDemucsInstalled() {
  ensureCudaTorch();
  try {
    execSync(`"${py}" -c "import demucs"`, { stdio: "pipe", cwd: root });
    execSync(`"${py}" -c "import soundfile"`, { stdio: "pipe", cwd: root });
    return;
  } catch {
    console.log("\n[dev] Demucs 스택 설치 중 (soundfile 포함)...");
    execSync(`"${py}" -m pip install soundfile demucs diffq`, {
      stdio: "inherit",
      cwd: root,
    });
    ensureCudaTorch();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function startDockerAi() {
  runQuiet(`docker rm -f ${DOCKER_NAME}`);
  if (!imageExists()) {
    console.log("\n[dev] Docker image not found — building (first time may take long)...");
    const build = spawn(
      "docker",
      ["build", "-f", "services/vocal-remover/Dockerfile", "-t", DOCKER_IMAGE, "."],
      { stdio: "inherit", shell: true, cwd: root },
    );
    await new Promise((resolve, reject) => {
      build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("docker build failed"))));
    });
  }

  const args = [
    "run",
    "-d",
    "--name",
    DOCKER_NAME,
    "--rm",
    "-p",
    `${AI_PORT}:8000`,
    "-e",
    "INFOTOOLS_LOCAL_SERVER=1",
    "-e",
    "INFOTOOLS_MOCK_AI=0",
    "-e",
    "RUNPOD_SERVERLESS=0",
  ];
  const useGpu = process.env.INFOTOOLS_DEV_CPU !== "1" && nvidiaAvailable();
  if (useGpu) args.push("--gpus", "all");

  console.log(`[dev] starting Docker AI (${useGpu ? "GPU" : "CPU"})...`);
  execSync(`docker ${args.join(" ")} ${DOCKER_IMAGE}`, { cwd: root, stdio: "inherit", shell: true });
  const health = await waitHealth(AI_URL, "Docker AI");
  validateRealAi(health, "Docker AI");
  aiMode = "docker";
}

async function startLocalAi() {
  ensureDemucsInstalled();
  console.log("[dev] starting local Python AI server...");
  run(py, ["services/vocal-remover/src/local_server.py"], {
    env: {
      INFOTOOLS_LOCAL_PORT: AI_PORT,
      INFOTOOLS_MOCK_AI: "0",
      PYTHONPATH: [
        path.join(root, "services", "vocal-remover", "src"),
        path.join(root, "libs", "py"),
      ].join(path.delimiter),
    },
  });
  const health = await waitHealth(AI_URL, "local AI");
  validateRealAi(health, "local AI");
  aiMode = "local";
}

async function resolveAiMode() {
  if (DEV_AI === "mock") {
    console.log("[dev] AI mode: mock (INFOTOOLS_MOCK_AI=1, no separate AI server)");
    aiMode = "mock";
    return;
  }
  if (DEV_AI === "docker") {
    if (!dockerOk()) throw new Error("Docker not available");
    await startDockerAi();
    return;
  }
  if (DEV_AI === "local") {
    await startLocalAi();
    return;
  }

  // auto
  if (dockerOk()) {
    try {
      await startDockerAi();
      return;
    } catch (err) {
      console.warn("[dev] Docker AI failed:", err.message);
    }
  }
  try {
    await startLocalAi();
  } catch (err) {
    console.error("\n[dev] 실제 AI를 시작할 수 없습니다:", err.message || err);
    console.error("\n해결 방법:");
    console.error("  1. Docker Desktop 실행 후: npm run dev");
    console.error("  2. 또는: pip install -r services/vocal-remover/requirements.txt 후 npm run dev");
    console.error("  3. UI만 빠르게: npm run dev:mock (가짜 분리 — 원본 그대로)\n");
    process.exit(1);
  }
}

function startMockInfra() {
  const env = {
    INFOTOOLS_MOCK_INFRA_PORT: MOCK_PORT,
    INFOTOOLS_MOCK_AI: aiMode === "mock" ? "1" : "0",
  };
  if (aiMode !== "mock") {
    env.INFOTOOLS_AI_SERVER_URL = AI_URL;
  }
  console.log(`[dev] mock-infra :${MOCK_PORT}  ai=${aiMode}  aiUrl=${env.INFOTOOLS_AI_SERVER_URL || "(in-process mock)"}`);
  run(py, ["apps/mock-infra/main.py"], { env });
}

function startWeb() {
  console.log("[dev] Vite http://127.0.0.1:5173");
  console.log("[dev] Vocal Remover → http://127.0.0.1:5173/sites/vocal-remover/\n");
  run("npm", ["run", "dev", "-w", "@infotools/web"], { cwd: root });
}

async function cleanupStaleDev() {
  console.log("[dev] cleaning stale processes (ports / docker)...");
  runQuiet(`docker rm -f ${DOCKER_NAME}`);
  for (const port of [Number(MOCK_PORT), Number(AI_PORT)]) {
    const killed = freePort(port);
    if (killed.length) {
      console.log(`[dev] freed port ${port} (pid ${killed.join(", ")})`);
    }
  }
  await sleep(500);
}

async function shutdown() {
  console.log("\n[dev] shutting down...");
  for (const child of children) {
    try {
      if (process.platform === "win32" && child.pid) {
        execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "pipe" });
      } else {
        child.kill("SIGTERM");
      }
    } catch {
      /* ignore */
    }
  }
  runQuiet(`docker rm -f ${DOCKER_NAME}`);
  freePort(Number(MOCK_PORT));
  freePort(Number(AI_PORT));
  process.exit(0);
}

async function main() {
  console.log("InfoTools dev — API + AI + Web\n");
  try {
    requirePython312(py, root);
  } catch (err) {
    console.error(`[dev] ${err.message}`);
    process.exit(1);
  }
  await cleanupStaleDev();
  await resolveAiMode();
  startMockInfra();
  await waitHealth(`http://127.0.0.1:${MOCK_PORT}`, "mock-infra", 60);
  setTimeout(startWeb, 800);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[dev] failed:", err.message || err);
  shutdown();
});
