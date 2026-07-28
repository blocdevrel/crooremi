import { env } from "../config";

/** Require EXECUTE_API_KEY for external callers (Bearer or x-api-key). Same-origin UI is allowed. */
export function assertExecuteAuth(req: Request): void {
  if (isSameOriginUi(req)) {
    return;
  }

  const configured = env.EXECUTE_API_KEY;
  if (!configured) {
    if (env.NODE_ENV === "production") {
      throw new AuthError("EXECUTE_API_KEY must be set in production");
    }
    console.warn(
      "[remifi] EXECUTE_API_KEY unset — allowing unauthenticated mutate in development",
    );
    return;
  }

  const bearer = req.headers.get("authorization");
  const headerKey = req.headers.get("x-api-key");
  const provided =
    headerKey?.trim() ||
    (bearer?.toLowerCase().startsWith("bearer ")
      ? bearer.slice(7).trim()
      : undefined);

  if (!provided || provided !== configured) {
    throw new AuthError("Invalid or missing API key");
  }
}

export function isSameOriginUi(req: Request): boolean {
  const host = req.headers.get("host");
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  const candidates = [origin, referer].filter(Boolean) as string[];
  for (const raw of candidates) {
    try {
      const u = new URL(raw);
      if (host && u.host === host) return true;
      if (env.NEXT_PUBLIC_APP_URL) {
        const app = new URL(env.NEXT_PUBLIC_APP_URL);
        if (u.origin === app.origin) return true;
      }
      if (
        (u.hostname === "localhost" || u.hostname === "127.0.0.1") &&
        host &&
        (host.startsWith("localhost:") || host.startsWith("127.0.0.1:"))
      ) {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
