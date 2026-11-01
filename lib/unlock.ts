import { env } from "cloudflare:workers";
import { createHash, randomBytes } from "node:crypto";
import { database, get } from "./store";

const requestTTL = 10 * 60_000;
type Unlock = {
  id: string; ref: string; owner: string; proofHash: string;
  surface: string; createdAt: number; expiresAt: number | null;
  status: "requesting" | "pending" | "approved" | "failed";
  actionId?: string; session?: string; approvedAt?: number;
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const validProof = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// The public request ID is not a credential. Only the originating webview has
// the random proof needed to retrieve a session after the owner approves.
export async function requestUnlock(ref: string, owner: string, proof: string, sheet: boolean) {
  const id = "ur_" + hash(ref + ":" + proof).slice(0, 32);
  const existing = await get<Unlock>("unlocks", id);
  if (existing) return { id, expiresAt: existing.expiresAt, created: false };
  const now = Date.now();
  const rate = await database().prepare("INSERT INTO mini_records(namespace,key,value,updated_at) VALUES('unlock_rate',?,'{}',?) ON CONFLICT(namespace,key) DO UPDATE SET updated_at=excluded.updated_at WHERE mini_records.updated_at < ? RETURNING key").bind(ref, now, now - 30_000).first();
  if (!rate) return null;
  const record: Unlock = { id, ref, owner, proofHash: hash(proof), surface: sheet ? "computer sheet" : "live computer card", createdAt: now, expiresAt: now + requestTTL, status: "requesting" };
  const inserted = await database().prepare("INSERT OR IGNORE INTO mini_records(namespace,key,value,updated_at) VALUES('unlocks',?,?,?)").bind(id, JSON.stringify(record), now).run();
  return { id, expiresAt: record.expiresAt, created: inserted.meta.changes === 1 };
}

export async function notifyUnlock(id: string) {
  const record = await get<Unlock>("unlocks", id);
  if (!record || record.status !== "requesting") return;
  let status: Unlock["status"] = "failed";
  try {
    if (!env.KEIKI_API_KEY || !env.KEIKI_AGENT_ID) throw new Error("Unlock is not configured");
    const result = await fetch(new URL(`/api/v1/developer/agents/${encodeURIComponent(env.KEIKI_AGENT_ID)}/notice`, env.KEIKI_API_URL ?? "https://onkeiki.com"), {
      method: "POST", headers: { authorization: `Bearer ${env.KEIKI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ phone: record.owner, text: `The owner pressed Unlock computer in their existing ${record.surface}. Propose the gated unlock_computer tool exactly once with request_id ${record.id}. Wait for native Keiki Vault approval. Do not approve on the owner's behalf, use confirm_pairing, send computer cards, or send new URLs. The existing card will unlock itself after approval. If the tool returns pending approval, stop and wait. Keep accompanying text brief.` }),
      signal: AbortSignal.timeout(15_000),
    });
    const receipt = await result.json() as { ok?: boolean; queued?: number; ran?: number };
    if (result.ok && receipt.ok && ((receipt.queued ?? 0) + (receipt.ran ?? 0) > 0)) status = "pending";
  } catch { /* An uncertain send is never retried automatically. */ }
  await database().prepare("UPDATE mini_records SET value=json_set(value,'$.status',?),updated_at=? WHERE namespace='unlocks' AND key=? AND json_extract(value,'$.status')='requesting'").bind(status, Date.now(), id).run();
}

export async function unlockForOwner(id: string, owner: string) {
  const record = await get<Unlock>("unlocks", id);
  return record && record.owner === owner && (record.status === "approved" || (record.expiresAt ?? 0) > Date.now()) && record.status !== "failed" ? record : null;
}

export async function approveUnlock(record: Unlock, actionId: string) {
  const now = Date.now(), session = "ps_" + randomBytes(24).toString("hex");
  // Both the request transition and session insert commit together. Replays
  // return the same session. An approved device has no timed relock.
  await database().batch([
    database().prepare("UPDATE mini_records SET value=json_set(value,'$.status','approved','$.actionId',?,'$.session',?,'$.approvedAt',?,'$.expiresAt',null),updated_at=? WHERE namespace='unlocks' AND key=? AND json_extract(value,'$.status') IN ('requesting','pending') AND json_extract(value,'$.expiresAt')>?").bind(actionId, session, now, now, record.id, now),
    database().prepare("INSERT OR IGNORE INTO mini_records(namespace,key,value,updated_at) SELECT 'sessions',json_extract(value,'$.session'),json_object('token',json_extract(value,'$.session'),'ref',json_extract(value,'$.ref'),'createdAt',?,'auth','keiki_vault'),? FROM mini_records WHERE namespace='unlocks' AND key=? AND json_extract(value,'$.status')='approved' AND json_extract(value,'$.actionId')=?").bind(new Date(now).toISOString(), now, record.id, actionId),
  ]);
  const current = await get<Unlock>("unlocks", record.id);
  return current?.status === "approved" && current.actionId === actionId;
}

export async function unlockStatus(ref: string, id: string, proof: string) {
  const record = await get<Unlock>("unlocks", id);
  if (!record || record.ref !== ref || record.proofHash !== hash(proof)) return null;
  if (record.status === "approved") return { status: "approved", session: record.session };
  if ((record.expiresAt ?? 0) <= Date.now()) return { status: "expired" };
  return { status: record.status, expiresAt: record.expiresAt };
}
