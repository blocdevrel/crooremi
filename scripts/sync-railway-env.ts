/**
 * Push .env.railway variables to linked Railway service.
 * Run: npm run railway:env
 *
 * Uses the local @railway/cli devDependency — avoids npx/npm-cache failures
 * when setting many variables in a row.
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.railway");
const require = createRequire(import.meta.url);

function parseEnvFile(raw: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) vars[key] = value;
  }
  return vars;
}

function resolveRailwayCli(): { command: string; argsPrefix: string[] } {
  try {
    const pkgPath = require.resolve("@railway/cli/package.json");
    const pkg = require(pkgPath) as { bin?: Record<string, string> };
    const relBin = pkg.bin?.railway ?? "bin/railway.js";
    const jsEntry = join(dirname(pkgPath), relBin);
    if (existsSync(jsEntry)) {
      return { command: process.execPath, argsPrefix: [jsEntry] };
    }
  } catch {
    // fall through to .bin shim
  }

  const isWin = process.platform === "win32";
  const shim = resolve(
    process.cwd(),
    "node_modules",
    ".bin",
    isWin ? "railway.cmd" : "railway",
  );
  if (existsSync(shim)) {
    return { command: shim, argsPrefix: [] };
  }

  throw new Error(
    "Railway CLI not installed. Run: npm install\n" +
      "(Installs @railway/cli locally — do not use npx for this script.)",
  );
}

function setRailwayVariable(
  cli: { command: string; argsPrefix: string[] },
  key: string,
  value: string,
  skipDeploy: boolean,
): void {
  const args = [
    ...cli.argsPrefix,
    "variable",
    "set",
    key,
    "--stdin",
    ...(skipDeploy ? ["--skip-deploys"] : []),
  ];

  const useShell =
    process.platform === "win32" &&
    (cli.command.endsWith(".cmd") || cli.command.endsWith(".bat"));

  const result = spawnSync(cli.command, args, {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
    cwd: process.cwd(),
    shell: useShell,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`railway variable set ${key} failed (exit ${result.status})`);
  }
}

function main(): void {
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    console.error("Missing .env.railway — copy from .env.railway.example");
    process.exit(1);
  }

  const cli = resolveRailwayCli();
  const vars = parseEnvFile(raw);
  const keys = Object.keys(vars);
  console.log(`\nSyncing ${keys.length} variables to Railway (crooremi)…\n`);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const value = vars[key]!;
    const skipDeploy = i < keys.length - 1;
    console.log(`  set ${key}`);
    setRailwayVariable(cli, key, value, skipDeploy);
  }

  console.log("\nRailway variables updated. Deploy triggered on last variable.\n");
}

main();
