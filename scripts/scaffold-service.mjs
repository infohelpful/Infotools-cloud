#!/usr/bin/env node
/**
 * Scaffold a new AI service from services/_template
 * Usage: npm run scaffold -- my-new-tool "My New Tool"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const id = process.argv[2];
const name = process.argv[3] || id;

if (!id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(id)) {
  console.error("Usage: npm run scaffold -- <service-id-kebab> [Display Name]");
  process.exit(1);
}

const templateDir = path.join(root, "services", "_template");
const destDir = path.join(root, "services", id);
if (fs.existsSync(destDir)) {
  console.error(`Already exists: ${destDir}`);
  process.exit(1);
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else {
      let text = fs.readFileSync(s, "utf8");
      text = text
        .replaceAll("__SERVICE_ID__", id)
        .replaceAll("__SERVICE_NAME__", name)
        .replaceAll("Model-N-service", id);
      fs.writeFileSync(d, text);
    }
  }
}

copyRecursive(templateDir, destDir);

const registryPath = path.join(root, "config", "services.registry.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
registry.services.push({
  id,
  name,
  nameKo: name,
  description: `${name} AI service`,
  enabled: false,
  adminOnly: true,
  sitePath: `/sites/${id}/`,
  manifestPath: `services/${id}/service.manifest.json`,
});
fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");

console.log(`Created service: ${destDir}`);
console.log(`Updated: ${registryPath}`);
console.log("Next: implement src/handler.py, add apps/web/sites/" + id + "/");
