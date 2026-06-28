#!/usr/bin/env node
/**
 * 로컬 Docker AI 서버 실행 (RunPod와 동일 이미지, HTTP 모드)
 *
 *   npm run docker:run:vocal-remover
 *   npm run docker:run:vocal-remover -- --cpu
 *   npm run docker:run:vocal-remover -- --mock
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const useCpu = args.includes("--cpu");
const useMock = args.includes("--mock");
const port = process.env.INFOTOOLS_LOCAL_PORT || "8000";
const image = process.env.DOCKER_IMAGE || "infotools/vocal-remover:latest";

const dockerArgs = [
  "run",
  "--rm",
  "-p",
  `${port}:8000`,
  "-e",
  "INFOTOOLS_LOCAL_SERVER=1",
  "-e",
  `INFOTOOLS_MOCK_AI=${useMock ? "1" : "0"}`,
  "-e",
  "RUNPOD_SERVERLESS=0",
];

if (!useCpu) {
  dockerArgs.push("--gpus", "all");
}

dockerArgs.push(image);

console.log(`> docker ${dockerArgs.join(" ")}`);
console.log(`> http://127.0.0.1:${port}/health`);
console.log(`> curl test: npm run docker:test:vocal-remover`);

const child = spawn("docker", dockerArgs, {
  stdio: "inherit",
  shell: process.platform === "win32",
  cwd: root,
});

child.on("exit", (code) => process.exit(code ?? 0));
