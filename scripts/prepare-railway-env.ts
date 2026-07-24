import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const src = resolve(process.cwd(), ".env");
const dest = resolve(process.cwd(), ".env.railway");
const raw = readFileSync(src, "utf8");
const out: string[] = [];

for (const line of raw.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (key) out.push(`${key}=${value}`);
}

writeFileSync(dest, `${out.join("\n")}\n`, "utf8");
console.log(`wrote .env.railway keys=${out.length}`);
