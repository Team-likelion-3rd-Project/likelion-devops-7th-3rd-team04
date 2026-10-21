#!/usr/bin/env node
// `n8n import:workflow`는 import한 워크플로를 항상 비활성 상태로 만듭니다 — 이 저장소의
// 문제가 아니라 n8n CLI의 문서화된 동작입니다
// (https://community.n8n.io/t/disable-deactivating-workflow-during-import/28217).
// 게다가 이 n8n 버전은 "active"를 draft/publish 라이프사이클과 분리해서,
// `PATCH /rest/workflows/:id {"active":true}`는 조용히 무시되고 웹훅은
// `POST /rest/workflows/:id/activate`(로그인 세션 + 현재 `versionId` 필요)로만 등록됩니다.
//
// 이 스크립트는 `n8n import:workflow` 직후(docker-compose.yml의 n8n-init) 실행되어,
// 최초 실행 시 만든 로컬 owner 계정으로 n8n 내부 REST API를 호출해 활성화합니다.
// n8n Alpine 이미지에는 curl/jq가 없어서 외부 의존성 없이 Node 내장 `fetch`만 씁니다.

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
      // 아직 기동 전 — 계속 재시도
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`n8n did not become ready at ${N8N_URL} in time`);
}

// `/healthz`가 통과해도 REST 라우트가 아직 등록되지 않았을 수 있습니다 — 완전히 새로
// 띄울 때는 헬스체크 통과 후 몇 초간 POST /rest/login 등이 404("Cannot POST /rest/login",
// 인증 거부가 아니라 라우트 미등록)를 냅니다. 그래서 헬스체크뿐 아니라
// owner/login/activate 전체를 재시도합니다.
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
  // 빈 n8n_data 볼륨에서 처음 실행: owner가 없으므로 /rest/owner/setup이 계정을 만들고 로그인까지 합니다.
  // 이후 재실행(owner 이미 존재): setup이 거부되므로 일반 로그인으로 넘어갑니다.
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
