#!/usr/bin/env node
/**
 * 로컬 표준 환경: Python 3.12 + .venv
 * - NVIDIA GPU 있으면 CUDA torch (cu124)
 * - demucs, soundfile, mock-infra deps
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPython312, venvPythonPath } from "./python-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venvDir = path.join(root, ".venv");
const py312 = process.env.INFOTOOLS_PYTHON312 || "py -3.12";
const cuIndex = process.env.INFOTOOLS_TORCH_CUDA_INDEX || "https://download.pytorch.org/whl/cu124";

function nvidiaAvailable() {
  try {
    execSync("nvidia-smi", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function rmVenv() {
  if (!fs.existsSync(venvDir)) return;
  console.log("[setup] 기존 .venv 제거 중...");
  try {
    fs.rmSync(venvDir, { recursive: true, force: true });
    return;
  } catch (err) {
    const legacy = `${venvDir}.legacy-${Date.now()}`;
    console.warn(`[setup] .venv 삭제 실패 (${err.code}) — ${legacy} 로 이름 변경 시도`);
    fs.renameSync(venvDir, legacy);
  }
}

function migrateGpuVenv() {
  const gpuDir = path.join(root, ".venv-gpu");
  const gpuPy = path.join(gpuDir, "Scripts", "python.exe");
  if (!fs.existsSync(gpuPy) || !isPython312(gpuPy, root)) {
    return false;
  }
  if (fs.existsSync(venvDir)) {
    return false;
  }
  console.log("[setup] .venv-gpu → .venv 이전 (Python 3.12)");
  fs.renameSync(gpuDir, venvDir);
  return true;
}

const py = venvPythonPath(root);
if (fs.existsSync(py) && !isPython312(py, root)) {
  rmVenv();
}

if (!fs.existsSync(venvDir) && !migrateGpuVenv()) {
  console.log("[setup] Python 3.12 venv 생성 →", venvDir);
  execSync(`${py312} -m venv "${venvDir}"`, { stdio: "inherit", cwd: root, shell: true });
} else if (!fs.existsSync(venvDir)) {
  // migrateGpuVenv succeeded
} else if (!isPython312(py, root)) {
  console.error(
    "[setup] .venv 가 Python 3.12가 아닙니다. dev 서버를 종료한 뒤 npm run dev:stop → npm run setup",
  );
  process.exit(1);
}

console.log("[setup] pip upgrade");
execSync(`"${py}" -m pip install -U pip`, { stdio: "inherit", cwd: root });

if (nvidiaAvailable() && process.env.INFOTOOLS_DEV_CPU !== "1") {
  console.log("[setup] NVIDIA GPU — CUDA torch 설치");
  execSync(`"${py}" -m pip uninstall -y torch torchaudio`, { stdio: "inherit", cwd: root });
  execSync(`"${py}" -m pip install torch torchaudio --index-url ${cuIndex}`, {
    stdio: "inherit",
    cwd: root,
  });
} else {
  console.log("[setup] CPU torch 설치");
  execSync(`"${py}" -m pip install torch torchaudio`, { stdio: "inherit", cwd: root });
}

console.log("[setup] demucs + mock-infra");
execSync(`"${py}" -m pip install --no-cache-dir soundfile demucs diffq`, {
  stdio: "inherit",
  cwd: root,
});
execSync(`"${py}" -m pip install --no-cache-dir -r apps/mock-infra/requirements.txt`, {
  stdio: "inherit",
  cwd: root,
});

const check = execSync(
  `"${py}" -c "import sys, torch; print(f'Python {sys.version_info.major}.{sys.version_info.minor}', 'torch', torch.__version__, 'cuda', torch.cuda.is_available())"`,
  { encoding: "utf8", cwd: root },
);
console.log("[setup] 완료:", check.trim());
console.log("\n다음: npm run dev");
