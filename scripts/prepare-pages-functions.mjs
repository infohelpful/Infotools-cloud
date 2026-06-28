#!/usr/bin/env node
/**
 * Cloudflare Pages (monorepo root) — copy functions + sync bundled defaults.
 * Usage: node scripts/prepare-pages-functions.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcFunctions = path.join(root, "apps", "web", "functions");
const dstFunctions = path.join(root, "functions");
const defaultsDir = path.join(dstFunctions, "_shared", "defaults");

const copies = [
  ["config/environments/local.mock.json", "local.mock.json"],
  ["config/environments/staging.example.json", "staging.example.json"],
  ["config/environments/production.example.json", "production.example.json"],
  ["config/services.registry.json", "services.registry.json"],
];

function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.cpSync(src, dst, { recursive: true });
}

rmrf(dstFunctions);
copyDir(srcFunctions, dstFunctions);
fs.mkdirSync(defaultsDir, { recursive: true });

for (const [from, to] of copies) {
  fs.copyFileSync(path.join(root, from), path.join(defaultsDir, to));
}

console.log(`Prepared ${path.relative(root, dstFunctions)} for Cloudflare Pages.`);
