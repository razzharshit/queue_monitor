import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const localEnvPath = resolve(process.cwd(), ".env");

export function loadLocalEnvironment(): void {
  try {
    process.loadEnvFile(localEnvPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(".env is required; copy .env.example and configure it first", { cause: error });
    }
    throw error;
  }
}

export function requiredEnvironment(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required and must contain at least ${minimumLength} characters`);
  }
  return value;
}

export async function updateLocalEnvironment(updates: Record<string, string>): Promise<void> {
  const original = await readFile(localEnvPath, "utf8");
  const lines = original.split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !pending.has(match[1]!)) return line;
    const key = match[1]!;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${value}`;
  });
  if (pending.size > 0) {
    if (next.at(-1) !== "") next.push("");
    next.push("# Dedicated read-only demo workspace (generated locally)");
    for (const [key, value] of pending) next.push(`${key}=${value}`);
    next.push("");
  }
  const temporary = `${localEnvPath}.demo-${process.pid}.tmp`;
  await writeFile(temporary, next.join("\n"), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, localEnvPath);
  await chmod(localEnvPath, 0o600);
  Object.assign(process.env, updates);
}

export function ingestionEndpoint(): string {
  return (process.env.INGESTION_ENDPOINT ?? "http://localhost:3000").replace(/\/$/, "");
}
