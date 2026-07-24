import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isDatabaseEnabled,
  isDatabaseReady,
  loadPolicyFromDatabase,
  savePolicyToDatabase,
} from "./database.js";
import { loadPolicyFromCompletedOrders } from "./policy-lookup.js";
import { policyIdMatches } from "./policy-id.js";
import type { AgentClient } from "@croo-network/sdk";
import type { StoredPolicy } from "./types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const memoryStore = new Map<string, StoredPolicy>();

let policyDir: string | undefined;

function getPolicyDir(): string {
  if (policyDir) {
    return policyDir;
  }
  if (process.env.REMIFI_POLICY_DIR?.trim()) {
    policyDir = resolve(process.env.REMIFI_POLICY_DIR.trim());
    return policyDir;
  }
  policyDir = resolve(__dirname, "../../data/policies");
  return policyDir;
}

function policyFilePath(id: string, dir = getPolicyDir()): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) {
    throw new Error("Invalid policyId");
  }
  return join(dir, `${safe}.json`);
}

async function writeToDisk(delivery: StoredPolicy): Promise<void> {
  const dir = getPolicyDir();
  try {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(
      policyFilePath(delivery.policyId, dir),
      JSON.stringify(delivery, null, 2),
      "utf8",
    );
  } catch (err) {
    const tmpDir = join(tmpdir(), "remifi-policies");
    try {
      if (!existsSync(tmpDir)) {
        await mkdir(tmpDir, { recursive: true });
      }
      policyDir = tmpDir;
      await writeFile(
        policyFilePath(delivery.policyId, tmpDir),
        JSON.stringify(delivery, null, 2),
        "utf8",
      );
      console.warn("[remifi] policy store: using temp dir", tmpDir);
    } catch {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[remifi] policy disk save failed, in-memory only:", message);
    }
  }
}

export async function savePolicy(delivery: StoredPolicy): Promise<void> {
  memoryStore.set(delivery.policyId, delivery);

  if (isDatabaseEnabled() && isDatabaseReady()) {
    await savePolicyToDatabase(delivery);
    return;
  }

  await writeToDisk(delivery);
}

export type PolicyLoadContext = {
  client?: AgentClient;
  requesterAgentId?: string;
  createPolicyServiceId?: string;
};

export async function loadPolicyWithFallback(
  policyId: string,
  ctx?: PolicyLoadContext,
): Promise<StoredPolicy | null> {
  const local = await loadPolicy(policyId);
  if (local) {
    return local;
  }

  if (ctx?.client && ctx.createPolicyServiceId?.trim()) {
    const fromOrders = await loadPolicyFromCompletedOrders(
      ctx.client,
      policyId,
      ctx.createPolicyServiceId.trim(),
      ctx.requesterAgentId,
    );
    if (fromOrders) {
      console.log(
        `[remifi] execute: loaded policy ${policyId} from createPolicy order history`,
      );
      await savePolicy(fromOrders);
      return fromOrders;
    }
  }

  return null;
}

export async function loadPolicy(policyId: string): Promise<StoredPolicy | null> {
  const target = policyId.trim().toLowerCase();

  const cached = memoryStore.get(target);
  if (cached) {
    return cached;
  }

  for (const [id, policy] of memoryStore) {
    if (policyIdMatches(target, id)) {
      return policy;
    }
  }

  if (isDatabaseEnabled() && isDatabaseReady()) {
    const fromDb = await loadPolicyFromDatabase(target);
    if (fromDb) {
      memoryStore.set(fromDb.policyId, fromDb);
      return fromDb;
    }
  }

  const dirs = [
    getPolicyDir(),
    join(tmpdir(), "remifi-policies"),
    resolve(__dirname, "../../data/policies"),
  ];

  for (const dir of dirs) {
    const path = policyFilePath(policyId, dir);
    if (!existsSync(path)) {
      continue;
    }
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as StoredPolicy;
      memoryStore.set(policyId, parsed);
      return parsed;
    } catch {
    }
  }

  return null;
}

export function toStoredPolicy(
  delivery: Omit<StoredPolicy, "createdAt">,
): StoredPolicy {
  return {
    ...delivery,
    createdAt: new Date().toISOString(),
  };
}
