import type { Abi } from "viem";
import routerAbiJson from "./router.json" with { type: "json" };

/** Full Router ABI synced from contracts/out/Router.sol/Router.json */
export const routerAbi = routerAbiJson as Abi;
