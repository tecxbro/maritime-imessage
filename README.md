# Maritime × Keiki

Thin Worker host for the shared Keiki Live Mini SDK. Session lifecycle, streaming, card design and assets come from the included local SDK package; this app configures one adapter.

Requires Node 22.13+ and npm. Run npm install, copy .dev.vars.example to .dev.vars and fill it privately, run npm run db:init, then npm run dev. Use a stable public HTTPS origin for real Keiki cards.

Keiki calls POST /k/YOUR_TOOL_SECRET/open for one live card, or /interactive for an explicitly requested sheet. Send the normal {input,context} envelope; context.phone is the trusted sender. Supply a stable input.intentId on retries. New SDK integrations can instead use its signed /vm/tools/open endpoint and Keiki tool helper. Set KEIKI_WEBHOOK_SECRET to require signed legacy callbacks too.

Native Face ID approval remains in the host: configure unlock_computer with approval ask, verified proof, refuse fallback, and read-only preflight. It calls /k/YOUR_TOOL_SECRET/unlock. The existing card unlocks after Keiki Vault approval; approved sessions persist.

Verify with npm run typecheck, npm run build, and npm test. The integration test uses fake local provider and Keiki endpoints. It spends no provider credits and sends no messages. Deploying, publishing packages and checking a real iPhone are separate steps.

The local vendor archive makes this folder portable without access to the parent repository or npm publication. SDK licenses and notices are inside that package. No credentials, production Site identity or customer records are included.
