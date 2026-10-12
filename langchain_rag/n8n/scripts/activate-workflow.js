#!/usr/bin/env node
// `n8n import:workflow` always force-deactivates whatever it imports — this
// is documented n8n CLI behavior, not something specific to this repo's
// setup (https://community.n8n.io/t/disable-deactivating-workflow-during-import/28217).
// On top of that, this n8n build separates "active" from a draft/publish
// workflow lifecycle: a plain `PATCH /rest/workflows/:id {"active":true}`
// is silently ignored, and the webhook only actually registers via
// `POST /rest/workflows/:id/activate`, which itself requires an
// authenticated session and the workflow's current `versionId`.
//
// This script runs right after `n8n import:workflow` (see docker-compose.yml's
// n8n-init) and drives that activation over n8n's internal REST API, using a
// one-time local owner account it creates on first run. No third-party deps
// — n8n's Alpine image ships neither curl nor jq — just Node's built-in
// `fetch` (Node 18+; this image ships Node 24).

const fs = require('fs');

const N8N_URL = process.env.N8N_URL || 'http://n8n:5678';
const OWNER_EMAIL = process.env.N8N_INIT_OWNER_EMAIL || 'admin@example.com';
const OWNER_PASSWORD = process.env.N8N_INIT_OWNER_PASSWORD || 'ChangeMe123!';
const WORKFLOW_PATH = process.argv[2] || '/workflows/chat-orchestration.json';

async function waitForN8n() {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`${N8N_URL}/healthz`);
      if (res.ok) return;
    } catch {
      // not up yet, keep retrying
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`n8n did not become ready at ${N8N_URL} in time`);
}

// `/healthz` going green doesn't mean n8n's REST route table is mounted yet
// — on a fully fresh start (n8n and n8n-init coming up concurrently) calls
// like POST /rest/login can still 404 ("Cannot POST /rest/login", a route-
// not-registered-yet 404, not an auth rejection) for a few seconds after
// health checks pass. Retry the whole owner/login/activate sequence, not
// just the initial health check.
async function withRetries(fn, attempts = 10, delayMs = 3000) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`attempt ${i}/${attempts} failed: ${err.message}`);
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

function extractCookie(res) {
  const cookies =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (cookies.length) return cookies.map((c) => c.split(';')[0]).join('; ');
  const raw = res.headers.get('set-cookie');
  return raw ? raw.split(';')[0] : null;
}

async function ensureOwnerAndLogin() {
  // First run against a fresh n8n_data volume: no owner exists yet, so
  // /rest/owner/setup creates one and logs us in. Re-running n8n-init later
  // (owner already exists): setup rejects, fall back to a plain login.
  const setupRes = await fetch(`${N8N_URL}/rest/owner/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: OWNER_EMAIL,
      firstName: 'Admin',
      lastName: 'User',
      password: OWNER_PASSWORD,
    }),
  });
  if (setupRes.ok) return extractCookie(setupRes);

  const loginRes = await fetch(`${N8N_URL}/rest/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailOrLdapLoginId: OWNER_EMAIL, password: OWNER_PASSWORD }),
  });
  if (!loginRes.ok) {
    throw new Error(`n8n login failed (${loginRes.status}): ${await loginRes.text()}`);
  }
  return extractCookie(loginRes);
}

async function activateWorkflow(cookie) {
  const { id, name } = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

  const getRes = await fetch(`${N8N_URL}/rest/workflows/${id}`, {
    headers: { Cookie: cookie },
  });
  if (!getRes.ok) {
    throw new Error(`failed to fetch workflow ${id} (${getRes.status}): ${await getRes.text()}`);
  }
  const { data: workflow } = await getRes.json();

  if (workflow.active) {
    console.log(`"${name}" (${id}) is already active — nothing to do.`);
    return;
  }

  const activateRes = await fetch(`${N8N_URL}/rest/workflows/${id}/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ versionId: workflow.versionId }),
  });
  if (!activateRes.ok) {
    throw new Error(
      `failed to activate workflow ${id} (${activateRes.status}): ${await activateRes.text()}`,
    );
  }
  console.log(`"${name}" (${id}) activated — webhook is now live.`);
}

(async () => {
  await waitForN8n();
  await withRetries(async () => {
    const cookie = await ensureOwnerAndLogin();
    await activateWorkflow(cookie);
  });
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
