import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
spawn("node", [path.join(root, "scripts", "dev.mjs")], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, INFOTOOLS_DEV_AI: "mock" },
});
