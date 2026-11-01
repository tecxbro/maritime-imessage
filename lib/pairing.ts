import { get } from "./store";

const sessionTTL = 30 * 24 * 60 * 60 * 1000;
const fresh = (at: string, ttl: number) => Date.now() - Date.parse(at) < ttl;

export async function sessionRef(token: string | null, requireFaceId = false) {
  if (!token) return null;
  const s = await get<{ref: string; createdAt: string; auth?: string; expiresAt?: number}>("sessions", token);
  if (!s || (requireFaceId && s.auth !== "keiki_vault")) return null;
  // Includes Face ID sessions issued before the timed limit was removed.
  if (s.auth === "keiki_vault") return s.ref;
  return fresh(s.createdAt, sessionTTL) ? s.ref : null;
}
