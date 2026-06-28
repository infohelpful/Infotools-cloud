/** Kill processes listening on a TCP port (Windows + Unix). */

import { execSync } from "node:child_process";

/**
 * @param {number} port
 * @returns {number[]} killed PIDs
 */
export function freePort(port) {
  const pids = findListeningPids(port);
  for (const pid of pids) {
    if (pid <= 0 || pid === process.pid) continue;
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
      } else {
        execSync(`kill -9 ${pid}`, { stdio: "pipe" });
      }
    } catch {
      /* already gone */
    }
  }
  return pids;
}

/**
 * @param {number} port
 * @returns {number[]}
 */
export function findListeningPids(port) {
  const pids = new Set();
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano | findstr ":${port}"`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes("LISTENING")) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    } else {
      const out = execSync(`lsof -ti :${port} -sTCP:LISTEN`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      for (const line of out.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
    }
  } catch {
    /* port free */
  }
  return [...pids];
}

/**
 * @param {number} port
 * @returns {boolean}
 */
export function isPortInUse(port) {
  return findListeningPids(port).length > 0;
}
