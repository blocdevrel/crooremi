import { AgentClient, type Config } from "@croo-network/sdk";
import { env } from "../config.js";

export function createAgentClient(sdkKey = env.CROO_SDK_KEY): AgentClient {
  const config: Config = {
    baseURL: env.CROO_API_URL,
    wsURL: env.CROO_WS_URL,
    rpcURL: env.BASE_RPC_URL,
  };
  return new AgentClient(config, sdkKey);
}
