// GitHub 이벤트를 Jira 업무 / GitHub Projects 보드 상태로 동기화합니다.
// 의존성 없이 Node 20+ 내장 fetch만 사용합니다. 설정 방법은 docs/AUTOMATION.md 참고.
//
//   이슈 생성    -> Jira 업무 생성 (업무 유형·Epic·Sprint 매핑) + 이슈 제목 "[LDP-12] 제목" + 보드에 추가
//   브랜치 생성  -> Jira "진행 중" + 보드 "In progress"
//   PR 생성      -> Jira "검토 중" + 보드 "In review" + PR 제목 "[LDP-12] 제목"   (Draft PR은 Ready 전환 시)
//   이슈 닫기    -> Jira "완료"    + 보드 "Done"
//
// 브랜치·PR 은 브랜치 이름의 Jira 키(LDP-12-...)로 찾고, 없으면 GitHub 이슈 번호(issue02-..., feature/#12-...)로 찾습니다.

import { readFileSync } from 'node:fs';

const env = (name, fallback = '') => (process.env[name] ?? '').trim() || fallback;

const cfg = {
  repo: env('GITHUB_REPOSITORY'),
  ghToken: env('GITHUB_TOKEN'),
  projectToken: env('GH_PROJECT_TOKEN'),
  projectOwner: env('GH_PROJECT_OWNER', env('GITHUB_REPOSITORY').split('/')[0]),
  projectNumber: Number(env('GH_PROJECT_NUMBER', '0')),
  ghStatus: {
    inProgress: env('GH_STATUS_IN_PROGRESS', 'In progress'),
    inReview: env('GH_STATUS_IN_REVIEW', 'In review'),
    done: env('GH_STATUS_DONE', 'Done'),
  },
  jiraBase: env('JIRA_BASE_URL').replace(/\/+$/, ''),
  jiraEmail: env('JIRA_EMAIL'),
  jiraToken: env('JIRA_API_TOKEN'),
  jiraProject: env('JIRA_PROJECT_KEY'),
  jiraBoardId: env('JIRA_BOARD_ID'),
  jiraStatus: {
    inProgress: env('JIRA_STATUS_IN_PROGRESS', '진행 중'),
    inReview: env('JIRA_STATUS_IN_REVIEW', '검토 중'),
    done: env('JIRA_STATUS_DONE', '완료'),
  },
  // 종류 라벨 -> Jira 업무 유형 이름. 여기에 없는 이슈(회의록·트러블슈팅 등)는 Jira에 만들지 않습니다.
  issueTypeMap: JSON.parse(
    env('JIRA_ISSUE_TYPE_MAP', '{"feat":"feat","fix":"fix","test":"test","docs":"docs","infra":"infra"}'),
  ),
  // 역할 라벨 -> Jira Epic 이름
  epicMap: JSON.parse(
    env(
      'JIRA_EPIC_MAP',
      '{"role/onprem":"온프레미스","role/cloud":"클라우드","role/backend":"백엔드","role/frontend":"프론트엔드"}',
    ),
  ),
};

const warn = (msg) => console.log(`::warning::${msg}`);
const linkLabel = (n) => `github-issue-${n}`;
// 제목 앞의 [FEAT], [LDP-3] 같은 머리말을 모두 걷어냅니다.
const stripTitlePrefix = (title) => title.replace(/^(\s*\[[^\]]*\]\s*)+/, '').trim();
// 기한: 이슈 템플릿의 "### 예상 완료일" 칸 -> 없으면 Milestone(=Sprint) 마감일 -> 둘 다 없으면 null
const dueDateOf = (issue) =>
  (issue.body ?? '').match(/###\s*예상 완료일\s*\n+\s*(\d{4}-\d{2}-\d{2})/)?.[1] ??
  issue.milestone?.due_on?.slice(0, 10) ??
  null;
const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const labelNames = (issue) => issue.labels.map((l) => (typeof l === 'string' ? l : l.name));
const jiraTypeOf = (issue) => cfg.issueTypeMap[labelNames(issue).find((l) => cfg.issueTypeMap[l])];

// ---------------------------------------------------------------- GitHub

async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function ghGraphql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.projectToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub GraphQL -> ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

const getIssue = (n) => gh(`/repos/${cfg.repo}/issues/${n}`);

// 이슈: 머리말을 Jira 키로 교체 ("[FEAT] 제목" -> "[LDP-12] 제목")
async function setIssueTitleKey(issue, key) {
  const title = `[${key}] ${stripTitlePrefix(issue.title)}`;
  if (title === issue.title) return;
  await gh(`/repos/${cfg.repo}/issues/${issue.number}`, { method: 'PATCH', body: { title } });
  console.log(`이슈 제목: #${issue.number} -> ${title}`);
}

// PR: 앞에 Jira 키만 덧붙임 (이미 있으면 그대로)
async function setPrTitleKey(pr, key) {
  if (pr.title.includes(`[${key}]`)) return;
  const title = `[${key}] ${pr.title.trim()}`;
  await gh(`/repos/${cfg.repo}/pulls/${pr.number}`, { method: 'PATCH', body: { title } });
  console.log(`PR 제목: #${pr.number} -> ${title}`);
}

// ---------------------------------------------------------------- GitHub Projects 보드

let projectCache;
async function getProject() {
  if (projectCache) return projectCache;
  const fields = `id
    field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    fields(first: 50) { nodes { ... on ProjectV2Field { id name dataType } } }`;
  for (const ownerType of ['organization', 'user']) {
    const data = await ghGraphql(
      `query($login: String!, $number: Int!) { ${ownerType}(login: $login) { projectV2(number: $number) { ${fields} } } }`,
      { login: cfg.projectOwner, number: cfg.projectNumber },
    ).catch(() => null); // organization 이 아니면 user 로 재시도
    const project = data?.[ownerType]?.projectV2;
    if (project) return (projectCache = project);
  }
  throw new Error(`GitHub Project #${cfg.projectNumber} (owner: ${cfg.projectOwner}) 를 찾을 수 없습니다.`);
}

// 이슈를 보드에 올리고 카드(item) id 를 반환합니다. 이미 있으면 기존 카드를 반환합니다.
async function getProjectItemId(issue) {
  const project = await getProject();
  const { addProjectV2ItemById } = await ghGraphql(
    `mutation($projectId: ID!, $contentId: ID!) {
       addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } }
     }`,
    { projectId: project.id, contentId: issue.node_id },
  );
  return addProjectV2ItemById.item.id;
}

const projectEnabled = () => {
  if (cfg.projectToken && cfg.projectNumber) return true;
  warn('GH_PROJECT_TOKEN / GH_PROJECT_NUMBER 미설정 — 보드 갱신을 건너뜁니다.');
  return false;
};

// statusName 이 없으면 보드에 추가만 합니다.
async function setProjectStatus(issue, statusName) {
  if (!projectEnabled()) return;
  const project = await getProject();
  const itemId = await getProjectItemId(issue);
  if (!statusName) return;

  const option = project.field?.options.find((o) => o.name.toLowerCase() === statusName.toLowerCase());
  if (!option) {
    warn(`보드 Status "${statusName}" 이 없습니다. (있는 값: ${project.field?.options.map((o) => o.name).join(', ')})`);
    return;
  }
  await ghGraphql(
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
       updateProjectV2ItemFieldValue(input: {
         projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId }
       }) { projectV2Item { id } }
     }`,
    { projectId: project.id, itemId, fieldId: project.field.id, optionId: option.id },
  );
  console.log(`보드: #${issue.number} -> ${option.name}`);
}

// 보드 카드의 날짜 필드를 설정합니다. onlyIfEmpty: 이미 값이 있으면 그대로 둡니다.
async function setProjectDate(issue, fieldName, date, { onlyIfEmpty = false } = {}) {
  if (!date || !projectEnabled()) return;
  try {
    const project = await getProject();
    const field = project.fields.nodes.find((f) => f.name === fieldName && f.dataType === 'DATE');
    if (!field) return warn(`보드에 날짜 필드 "${fieldName}" 이 없습니다 — 건너뜁니다.`);
    const itemId = await getProjectItemId(issue);
    const { node } = await ghGraphql(
      `query($itemId: ID!, $name: String!) { node(id: $itemId) { ... on ProjectV2Item {
         fieldValueByName(name: $name) { ... on ProjectV2ItemFieldDateValue { date } } } } }`,
      { itemId, name: fieldName },
    );
    const current = node.fieldValueByName?.date;
    if (current === date || (onlyIfEmpty && current)) return;
    await ghGraphql(
      `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $date: Date!) {
         updateProjectV2ItemFieldValue(input: {
           projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { date: $date }
         }) { projectV2Item { id } }
       }`,
      { projectId: project.id, itemId, fieldId: field.id, date },
    );
    console.log(`보드: #${issue.number} ${fieldName} ${date}`);
  } catch (e) {
    warn(`보드 "${fieldName}" 설정 실패: ${e.message}`);
  }
}

// 보드 날짜를 Jira 와 같은 규칙으로 맞춥니다.
//   Target date = 예상 완료일 -> Milestone 마감일,  Start date = 브랜치 만든 날 (비어 있을 때만)
async function syncProjectDates(issue, step) {
  await setProjectDate(issue, 'Target date', dueDateOf(issue));
  if (step === 'inProgress') await setProjectDate(issue, 'Start date', todayKst(), { onlyIfEmpty: true });
}

// ---------------------------------------------------------------- Jira

async function jira(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${cfg.jiraBase}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${cfg.jiraEmail}:${cfg.jiraToken}`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jira ${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const jql = (query) =>
  jira(`/rest/api/3/search/jql?${new URLSearchParams({ jql: query, fields: 'summary,status', maxResults: '50' })}`).then(
    (r) => r.issues,
  );

let issueTypesCache;
async function getIssueTypes() {
  if (issueTypesCache) return issueTypesCache;
  const data = await jira(`/rest/api/3/issue/createmeta/${cfg.jiraProject}/issuetypes`);
  return (issueTypesCache = data.issueTypes ?? data.values ?? []);
}

async function getIssueTypeId(name) {
  const types = await getIssueTypes();
  const type = types.find((t) => t.name === name);
  if (!type) throw new Error(`Jira 업무 유형 "${name}" 이 없습니다. (있는 유형: ${types.map((t) => t.name).join(', ')})`);
  return type.id;
}

// Jira "시작 날짜" 필드 ID (커스텀 필드라 사이트마다 ID가 다름)
let startFieldCache;
async function getStartDateFieldId() {
  if (startFieldCache !== undefined) return startFieldCache;
  const fields = await jira('/rest/api/3/field');
  const field = fields.find((f) => ['Start date', '시작 날짜', '시작일'].includes(f.name));
  return (startFieldCache = field?.id ?? null);
}

// 브랜치 생성 시: 시작 날짜가 비어 있을 때만 오늘로 채웁니다. (두 번째 브랜치로 덮어쓰지 않음)
async function setJiraStartDate(key) {
  try {
    const fieldId = await getStartDateFieldId();
    if (!fieldId) return warn('Jira 에서 "시작 날짜" 필드를 찾지 못했습니다 — 건너뜁니다.');
    const { fields } = await jira(`/rest/api/3/issue/${key}?fields=${fieldId}`);
    if (fields[fieldId]) return;
    const date = todayKst();
    await jira(`/rest/api/3/issue/${key}`, { method: 'PUT', body: { fields: { [fieldId]: date } } });
    console.log(`Jira: ${key} 시작 날짜 ${date}`);
  } catch (e) {
    warn(`시작 날짜 설정 실패: ${e.message}`);
  }
}

// 이미 있는 업무의 기한을 예상 완료일 / Milestone 마감일에 맞춥니다. (본문·Milestone 이 바뀌었을 때 반영)
async function setJiraDueDate(key, issue) {
  const due = dueDateOf(issue);
  if (!due) return;
  try {
    const { fields } = await jira(`/rest/api/3/issue/${key}?fields=duedate`);
    if (fields.duedate === due) return;
    await jira(`/rest/api/3/issue/${key}`, { method: 'PUT', body: { fields: { duedate: due } } });
    console.log(`Jira: ${key} 기한 ${due}`);
  } catch (e) {
    warn(`기한 설정 실패: ${e.message}`);
  }
}

// 이미 만들어 둔 Epic 을 이름으로 찾습니다. 없으면 null (새로 만들지 않음).
async function findEpicKey(epicName) {
  const epicType = (await getIssueTypes()).find((t) => t.hierarchyLevel === 1);
  if (!epicType) return null;
  const found = await jql(`project = "${cfg.jiraProject}" AND issuetype = ${epicType.id} AND summary ~ "\\"${epicName}\\""`);
  return found.find((i) => i.fields.summary.trim() === epicName)?.key ?? null;
}

// Milestone 과 Sprint 는 앞의 "M<번호>." 로만 맞춥니다. 이름 뒷부분이 달라도 연결됩니다.
const sprintKey = (name) => name.trim().match(/^(M\d+)\./i)?.[1].toUpperCase() ?? name.trim();

async function findSprint(milestoneTitle) {
  const want = sprintKey(milestoneTitle);
  for (let startAt = 0; ; ) {
    const page = await jira(`/rest/agile/1.0/board/${cfg.jiraBoardId}/sprint?state=active,future&startAt=${startAt}`);
    const sprint = page.values.find((s) => sprintKey(s.name) === want);
    if (sprint) return sprint;
    if (page.isLast || !page.values.length) return null;
    startAt += page.values.length;
  }
}

function toAdf(issue) {
  const body = (issue.body ?? '').slice(0, 30000);
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'GitHub: ' },
          { type: 'text', text: `${cfg.repo}#${issue.number}`, marks: [{ type: 'link', attrs: { href: issue.html_url } }] },
        ],
      },
      ...body
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    ],
  };
}

async function findJiraIssue(issueNumber) {
  const [found] = await jql(`project = "${cfg.jiraProject}" AND labels = "${linkLabel(issueNumber)}"`);
  return found ?? null;
}

async function createJiraIssue(issue, typeName) {
  const fields = {
    project: { key: cfg.jiraProject },
    issuetype: { id: await getIssueTypeId(typeName) },
    summary: `#${issue.number} ${stripTitlePrefix(issue.title)}`.slice(0, 255),
    description: toAdf(issue),
    labels: [linkLabel(issue.number)],
  };
  if (dueDateOf(issue)) fields.duedate = dueDateOf(issue);

  // Epic: role/... 라벨
  const roleLabel = labelNames(issue).find((l) => cfg.epicMap[l]);
  if (roleLabel) {
    const epicKey = await findEpicKey(cfg.epicMap[roleLabel]).catch((e) => warn(`Epic 조회 실패: ${e.message}`));
    if (epicKey) fields.parent = { key: epicKey };
    else warn(`Epic "${cfg.epicMap[roleLabel]}" 을 찾지 못했습니다 — Epic 없이 생성합니다.`);
  }

  const created = await jira('/rest/api/3/issue', { method: 'POST', body: { fields } });
  console.log(`Jira: ${created.key} 생성 (GitHub #${issue.number}, 유형 ${typeName})`);

  // Sprint: Milestone
  if (issue.milestone?.title) {
    try {
      const sprint = await findSprint(issue.milestone.title);
      if (sprint) {
        await jira(`/rest/agile/1.0/sprint/${sprint.id}/issue`, { method: 'POST', body: { issues: [created.key] } });
        console.log(`Jira: ${created.key} -> Sprint "${sprint.name}"`);
      } else {
        warn(`Milestone "${issue.milestone.title}" 에 맞는 Sprint 가 없습니다 — 백로그에 둡니다.`);
      }
    } catch (e) {
      warn(`Sprint 연결 실패: ${e.message}`);
    }
  }

  await gh(`/repos/${cfg.repo}/issues/${issue.number}/comments`, {
    method: 'POST',
    body: { body: `🔗 Jira 업무가 생성되었습니다: [${created.key}](${cfg.jiraBase}/browse/${created.key})` },
  });
  return created;
}

// 이슈 제목의 [LDP-12] 로 Jira 업무를 찾습니다. 키가 없거나 Jira에 없는 업무면 null.
async function jiraKeyFromTitle(issue) {
  const key = issue.title.match(new RegExp(`^\\s*\\[(${cfg.jiraProject}-\\d+)\\]`, 'i'))?.[1].toUpperCase();
  if (!key) return null;
  return jira(`/rest/api/3/issue/${key}?fields=status`).then(
    () => key,
    () => null,
  );
}

// GitHub 이슈와 짝인 Jira 키를 반환합니다. 없으면 만들고, 이슈 제목에 키를 붙입니다. Jira 대상이 아니면 null.
//   1) 제목의 [LDP-12]  — 검색 없이 바로 확인 (생성 직후에도 정확)
//   2) Jira 라벨 github-issue-N 검색 — 제목에서 키가 지워졌을 때의 안전장치
//   3) 둘 다 없으면 새로 생성
async function syncJiraIssue(issue) {
  let key = (await jiraKeyFromTitle(issue)) ?? (await findJiraIssue(issue.number))?.key;
  if (key) {
    await setJiraDueDate(key, issue);
  } else {
    const typeName = jiraTypeOf(issue);
    if (!typeName) {
      console.log(`#${issue.number}: 종류 라벨(${Object.keys(cfg.issueTypeMap).join('/')}) 없음 — Jira 대상이 아닙니다.`);
      return null;
    }
    key = (await createJiraIssue(issue, typeName)).key; // 기한은 생성 시 함께 들어감
  }
  await setIssueTitleKey(issue, key);
  return key;
}

// Jira 업무에 붙은 github-issue-N 라벨로 GitHub 이슈 번호를 찾습니다.
async function githubNumberOfJira(key) {
  const { fields } = await jira(`/rest/api/3/issue/${key}?fields=labels`);
  const label = fields.labels.find((l) => l.startsWith(linkLabel('')));
  return label ? Number(label.slice(linkLabel('').length)) : null;
}

async function transitionJira(key, statusName) {
  const norm = (s) => s.replace(/\s+/g, '').toLowerCase();
  const { transitions } = await jira(`/rest/api/3/issue/${key}/transitions`);
  const t = transitions.find((x) => norm(x.to.name) === norm(statusName));
  if (!t) {
    const { fields } = await jira(`/rest/api/3/issue/${key}?fields=status`);
    if (norm(fields.status.name) === norm(statusName)) return console.log(`Jira: ${key} 이미 "${fields.status.name}"`);
    warn(`Jira ${key}: "${statusName}" 로 가는 전환이 없습니다. (가능: ${transitions.map((x) => x.to.name).join(', ')})`);
    return;
  }
  await jira(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
  console.log(`Jira: ${key} -> ${t.to.name}`);
}

// ---------------------------------------------------------------- 브랜치 / PR 에서 대상 찾기

// Jira 에서 만든 브랜치: LDP-12-..., feature/LDP-12-...
function jiraKeyFromBranch(ref) {
  return ref.match(new RegExp(`(?:^|[/_-])(${cfg.jiraProject}-\\d+)(?=[-_/]|$)`, 'i'))?.[1].toUpperCase() ?? null;
}

// 직접 만든 브랜치: issue02-..., issue-2-..., feature/#12-..., fix/12-..., 12-...
function issueNumberFromBranch(ref) {
  const m = ref.match(/issue[-_]?#?(\d+)/i) ?? ref.match(/(?:^|\/)#?(\d+)(?=[-_]|$)/);
  return m ? Number(m[1]) : null;
}

// 반환: [{ jiraKey?, ghNumber? }]
async function targetsFromBranch(ref) {
  const jiraKey = jiraKeyFromBranch(ref);
  if (jiraKey) {
    try {
      return [{ jiraKey, ghNumber: await githubNumberOfJira(jiraKey) }];
    } catch (e) {
      warn(`Jira 업무 ${jiraKey} 조회 실패 — 건너뜁니다. (${e.message})`);
      return [];
    }
  }
  const ghNumber = issueNumberFromBranch(ref);
  return ghNumber ? [{ ghNumber }] : [];
}

async function targetsFromPr(pr) {
  const targets = await targetsFromBranch(pr.head.ref);
  for (const m of (pr.body ?? '').matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s+#(\d+)/gi)) {
    const ghNumber = Number(m[1]);
    if (!targets.some((t) => t.ghNumber === ghNumber)) targets.push({ ghNumber });
  }
  return targets;
}

// ---------------------------------------------------------------- 단계

// Jira 업무와 GitHub 보드를 step 상태로 옮기고, 해당 Jira 키를 반환합니다.
async function moveTarget({ jiraKey, ghNumber }, step) {
  let issue = null;
  if (ghNumber) {
    issue = await getIssue(ghNumber).catch(() => null);
    if (!issue || issue.pull_request) {
      warn(`#${ghNumber} 은(는) 이슈가 아닙니다 — GitHub 쪽은 건너뜁니다.`);
      issue = null;
    }
  }
  if (!jiraKey && issue) jiraKey = await syncJiraIssue(issue);
  if (jiraKey) await transitionJira(jiraKey, cfg.jiraStatus[step]);
  if (jiraKey && step === 'inProgress') await setJiraStartDate(jiraKey);
  if (issue) await setProjectStatus(issue, cfg.ghStatus[step]);
  if (issue) await syncProjectDates(issue, step);
  return jiraKey;
}

async function main() {
  for (const name of ['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY', 'JIRA_BOARD_ID', 'GITHUB_TOKEN']) {
    if (!env(name)) throw new Error(`${name} 가 설정되지 않았습니다.`);
  }
  // SYNC_EVENT_* 는 테스트용 덮어쓰기 (GITHUB_* 기본 변수는 덮어쓸 수 없음)
  const eventName = env('SYNC_EVENT_NAME', env('GITHUB_EVENT_NAME'));
  const event = JSON.parse(readFileSync(env('SYNC_EVENT_PATH', env('GITHUB_EVENT_PATH')), 'utf8'));

  if (eventName === 'issues' && event.action === 'opened') {
    await syncJiraIssue(event.issue);
    if (cfg.projectToken && cfg.projectNumber) {
      await setProjectStatus(event.issue, null);
      await syncProjectDates(event.issue, 'opened');
    }
    return;
  }

  if (eventName === 'issues' && event.action === 'closed') {
    await moveTarget({ ghNumber: event.issue.number }, 'done');
    return;
  }

  if (eventName === 'create' && event.ref_type === 'branch') {
    const targets = await targetsFromBranch(event.ref);
    if (!targets.length) return console.log(`브랜치 "${event.ref}" 에서 Jira 키 / 이슈 번호를 찾지 못했습니다 — 건너뜁니다.`);
    for (const t of targets) await moveTarget(t, 'inProgress');
    return;
  }

  if (eventName === 'pull_request') {
    const pr = event.pull_request;
    if (pr.draft) return console.log('Draft PR — Ready for review 로 바꿀 때 처리합니다.');
    const targets = await targetsFromPr(pr);
    if (!targets.length) return console.log('PR 에서 Jira 키 / 연결된 이슈를 찾지 못했습니다 — 건너뜁니다.');
    const keys = [];
    for (const t of targets) keys.push(await moveTarget(t, 'inReview'));
    const key = keys.find(Boolean);
    if (key) await setPrTitleKey(pr, key);
    return;
  }

  console.log(`처리 대상이 아닌 이벤트: ${eventName} / ${event.action ?? event.ref_type}`);
}

main().catch((e) => {
  console.log(`::error::${e.message}`);
  process.exit(1);
});
