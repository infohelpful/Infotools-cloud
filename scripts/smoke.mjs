#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requirePython312, resolvePython } from "./python-path.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const py = resolvePython(root);

try {
  requirePython312(py, root);
} catch (err) {
  console.error(`[smoke] ${err.message}`);
  process.exit(1);
}

const child = spawn(py, ["scripts/smoke-e2e.py"], {
  stdio: "inherit",
  cwd: root,
  shell: false,
});
child.on("exit", (code) => process.exit(code ?? 0));
