import type { Abi } from "viem";
import routerAbiJson from "./router.json";

/** Full Remifi Router ABI — synced from `npm run contracts:sync-abi`. */
export const routerAbi = routerAbiJson as Abi;
