/**
 * Copy Router ABI from Foundry artifact into src/chain/abi/router.json.
 * Run after: npm run contracts:build
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const artifactPath = resolve(
  process.cwd(),
  "contracts/out/Router.sol/Router.json",
);
const outDir = resolve(process.cwd(), "src/chain/abi");
const outPath = resolve(outDir, "router.json");

function main(): void {
  let raw: string;
  try {
    raw = readFileSync(artifactPath, "utf8");
  } catch {
    console.error(
      "Missing Router artifact — run: npm run contracts:build",
    );
    process.exit(1);
  }

  const artifact = JSON.parse(raw) as { abi?: unknown[] };
  if (!Array.isArray(artifact.abi) || artifact.abi.length === 0) {
    console.error("Router.json has no abi array");
    process.exit(1);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact.abi, null, 2)}\n`, "utf8");
  console.log(`Synced ${artifact.abi.length} ABI entries → src/chain/abi/router.json`);
}

main();
