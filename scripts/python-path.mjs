/** 로컬 Python 3.12 venv 경로 (단일 .venv) */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const PYTHON_MINOR_REQUIRED = 12;

export function venvPythonPath(root) {
  if (process.platform === "win32") {
    return path.join(root, ".venv", "Scripts", "python.exe");
  }
  return path.join(root, ".venv", "bin", "python");
}

export function resolvePython(root) {
  if (process.env.INFOTOOLS_PYTHON) {
    return process.env.INFOTOOLS_PYTHON;
  }
  const venvPy = venvPythonPath(root);
  if (fs.existsSync(venvPy)) {
    return venvPy;
  }
  return "python";
}

export function pythonVersionMinor(py, root) {
  const out = execSync(
    `"${py}" -c "import sys; print(sys.version_info.major, sys.version_info.minor)"`,
    { encoding: "utf8", cwd: root, stdio: ["pipe", "pipe", "pipe"] },
  ).trim();
  const [major, minor] = out.split(/\s+/).map(Number);
  return { major, minor, text: `${major}.${minor}` };
}

export function isPython312(py, root) {
  try {
    const { major, minor } = pythonVersionMinor(py, root);
    return major === 3 && minor === PYTHON_MINOR_REQUIRED;
  } catch {
    return false;
  }
}

export function requirePython312(py, root) {
  if (!fs.existsSync(py) && py === "python") {
    throw new Error(
      "Python 3.12 가상환경이 없습니다. 먼저 실행: npm run setup",
    );
  }
  if (!isPython312(py, root)) {
    const ver = (() => {
      try {
        return pythonVersionMinor(py, root).text;
      } catch {
        return "unknown";
      }
    })();
    throw new Error(
      `로컬 Python은 3.12만 지원합니다 (현재 ${ver}). npm run setup 으로 .venv 를 다시 만드세요.`,
    );
  }
}
