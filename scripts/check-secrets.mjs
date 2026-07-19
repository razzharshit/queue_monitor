import { readdir, readFile } from "node:fs/promises";
import { extname, relative } from "node:path";

const root = new URL("../", import.meta.url);
const ignoredDirectories = new Set(["node_modules", "dist", ".git", "coverage"]);
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".yml", ".yaml", ".sql"]);
const findings = [];
const patterns = [
  { name: "private key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { name: "AWS access key", expression: /AKIA[0-9A-Z]{16}/g },
  { name: "Queue Monitor API key", expression: /qmon_live_[A-Za-z0-9_-]{24,}/g },
  { name: "GitHub token", expression: /gh[pousr]_[A-Za-z0-9]{30,}/g },
];

function synthetic(value) {
  return /replace|example|fixture|test/i.test(value) || /^qmon_live_(.)\1+$/.test(value);
}

async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      await scan(url);
      continue;
    }
    const path = url.pathname;
    const name = relative(root.pathname, path);
    if (name === ".env" || name.startsWith("infra/.env") || name === "package-lock.json" || name === "pnpm-lock.yaml") continue;
    if (!textExtensions.has(extname(name)) && !["Dockerfile", ".gitignore"].includes(entry.name)) continue;
    const content = await readFile(url, "utf8");
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern.expression)) {
        if (!synthetic(match[0])) findings.push(`${name}: possible ${pattern.name}`);
      }
    }
  }
}

await scan(root);
if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ level: "info", event: "secret_scan_passed" }));
}
