#!/usr/bin/env node
/** 이전 npm run dev 가 남긴 프로세스·포트 정리 */
import { execSync } from "node:child_process";
import { freePort } from "./free-port.mjs";

const DOCKER_NAME = "infotools-vocal-remover-dev";
const ports = [
  process.env.INFOTOOLS_MOCK_INFRA_PORT || "19427",
  process.env.INFOTOOLS_AI_PORT || "8000",
];

try {
  execSync(`docker rm -f ${DOCKER_NAME}`, { stdio: "pipe", shell: true });
  console.log(`stopped docker: ${DOCKER_NAME}`);
} catch {
  /* none */
}

for (const p of ports) {
  const killed = freePort(Number(p));
  if (killed.length) console.log(`freed :${p} → pid ${killed.join(", ")}`);
}

console.log("done — npm run dev 다시 실행하세요");
