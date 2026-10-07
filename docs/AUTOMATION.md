# GitHub · Jira · Slack 자동화

이슈를 만들고, 브랜치를 따고, PR을 올리고, 이슈를 닫는 것만으로
**Jira 업무**와 **GitHub Projects 보드(team-04 진행보드)** 상태가 자동으로 바뀝니다.

- 워크플로우: [`.github/workflows/jira-sync.yml`](../.github/workflows/jira-sync.yml)
- 로직: [`.github/scripts/jira-sync.mjs`](../.github/scripts/jira-sync.mjs)

---

## 1. 무엇이 자동으로 되나

| 내가 하는 일 | Jira | GitHub 보드 |
|---|---|---|
| 이슈 생성 | 백로그에 업무 생성 + 이슈에 Jira 링크 댓글 | 보드에 추가 + 이슈 제목 `[LDP-12] 제목` |
| 브랜치 생성 (Jira에서 또는 직접 push) | **진행 중** | **In progress** |
| PR 생성 (Draft는 Ready for review 전환 시) | **검토 중** | **In review** + PR 제목 `[LDP-12] 제목` |
| 이슈 닫기 | **완료** | **Done** |

> 이슈 제목은 앞의 머리말(`[FEAT]` 등)을 지우고 Jira 키로 바꿉니다. PR 제목은 앞에 Jira 키만 덧붙입니다.

### GitHub → Jira 매핑

| GitHub | Jira | 비고 |
|---|---|---|
| Issue | 업무 | 제목은 `#번호 이슈제목` |
| `feat` / `fix` / `test` / `docs` / `infra` 라벨 | 같은 이름의 **업무 유형** | **이 라벨이 없으면 Jira에 만들지 않음** (회의록·트러블슈팅 등) |
| `role/onprem` · `role/cloud` · `role/backend` · `role/frontend` | Epic 온프레미스 · 클라우드 · 백엔드 · 프론트엔드 | Epic은 미리 만들어 둔 것만 연결 |
| Milestone `M1. ...` | Sprint `M1. ...` | 앞의 **`M번호.`** 만 같으면 연결 (뒷부분 이름은 달라도 됨) |
| 이슈 본문의 **예상 완료일**, 없으면 **Milestone 마감일** | 기한 | 예상 완료일은 기능 개발 템플릿에만 있는 칸. 본문·Milestone 을 바꾸면 다음 단계(브랜치·PR·닫기)에서 반영 |
| 브랜치 만든 날 (한국 시간) | 시작 날짜 | 처음 한 번만 채움. 브랜치를 또 만들어도 바뀌지 않음 |

> 같은 날짜가 **team-04 진행보드의 Start date / Target date** 필드에도 똑같이 들어갑니다. (`GH_PROJECT_TOKEN` 사용)
> 이슈 사이드바의 "Fields"(조직 이슈 필드)가 아니라 "Projects → team-04 진행보드" 아래의 날짜입니다.

> GitHub 이슈와 Jira 업무는 두 가지로 연결됩니다.
> - GitHub → Jira: 이슈 제목 앞의 `[LDP-12]` (먼저 확인)
> - Jira → GitHub: Jira 업무의 라벨 `github-issue-<번호>` (제목에서 키가 지워졌을 때도 이걸로 찾음)
>
> Jira 라벨 `github-issue-<번호>` 는 지우지 마세요.

### 브랜치 만들기

**Jira 업무 화면 → 개발 → 브랜치 만들기** 로 만드는 것을 기본으로 합니다. (GitHub for Jira 앱 필요)

- 기준 브랜치는 **`develop`** 으로 고릅니다. 브랜치 생성 시에는 새 브랜치에 들어 있는 워크플로우가 실행되기 때문입니다.
- 브랜치 이름은 `LDP-12-...` 처럼 Jira 키로 시작합니다.

브랜치 이름에서 아래 순서로 대상을 찾습니다.

```
LDP-12-kakao-login           → Jira LDP-12 (→ 연결된 GitHub 이슈)
issue02-github-jira-연동      → GitHub #2
feature/#12-add-login-api    → GitHub #12
fix/34-signup-error          → GitHub #34
```

PR은 브랜치 이름과 PR 본문의 `Closes #번호` 를 모두 봅니다. PR 본문에 `Closes #번호` 를 써야 머지할 때 이슈가 닫히고 Jira도 완료가 됩니다.

---

## 2. 처음 한 번만 하는 설정 (저장소 관리자)

`Settings → Secrets and variables → Actions` 에서 등록합니다.

### Secrets

| 이름 | 값 |
|---|---|
| `JIRA_EMAIL` | Jira 로그인 이메일 |
| `JIRA_API_TOKEN` | Jira API 토큰 (아래 2-1) |
| `GH_PROJECT_TOKEN` | GitHub 보드 수정용 토큰 (아래 2-2) |

### Variables

| 이름 | 값 |
|---|---|
| `GH_PROJECT_NUMBER` | 보드 URL `.../projects/<숫자>` 의 숫자 |

Jira 주소(`likelion-devops-7th-3rd-team04.atlassian.net`), 프로젝트 키(`LDP`), 보드 번호(`2`)는 비밀값이 아니라서 워크플로우 파일에 직접 적혀 있습니다.

### 2-1. Jira API 토큰 만들기

1. https://id.atlassian.com/manage-profile/security/api-tokens 접속
2. **API 토큰 만들기** → 이름 입력(예: `github-actions`) → 복사
3. `JIRA_API_TOKEN` 시크릿에 붙여 넣기

토큰은 만든 사람의 권한으로 동작합니다. Jira 프로젝트 `LDP` 에 업무를 만들고 옮길 수 있는 계정이어야 합니다.

### 2-2. GitHub 보드 수정용 토큰 만들기

Actions 기본 토큰(`GITHUB_TOKEN`)으로는 Projects 보드를 바꿀 수 없어서 별도 토큰이 필요합니다.

1. GitHub → Settings → Developer settings → **Personal access tokens → Tokens (classic)**
2. **Generate new token (classic)**
3. Scope: **`project`**, **`repo`** 체크
4. 생성된 토큰을 `GH_PROJECT_TOKEN` 시크릿에 붙여 넣기
5. 조직(Team-likelion-3rd-Project)에서 토큰 승인을 요구하면 승인 요청

> 이 토큰이 없으면 Jira 동기화만 되고 보드 갱신은 경고와 함께 건너뜁니다.

---

## 3. Slack 연동 (공식 앱)

자동화 결과는 아래 공식 앱이 Slack 채널로 알려줍니다. 코드 설정은 없습니다.

### GitHub 앱

1. Slack → 앱 추가 → **GitHub** 설치 후 GitHub 계정 연결
2. 알림 받을 채널에서:

```
/invite @GitHub
/github subscribe Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04 issues pulls commits reviews
```

### Jira Cloud 앱

1. Slack → 앱 추가 → **Jira Cloud** 설치 후 `likelion-devops-7th-3rd-team04.atlassian.net` 연결
2. 알림 받을 채널에서:

```
/invite @Jira Cloud
/jira connect
```

3. 프로젝트 `LDP` 선택 → 알림 받을 이벤트(업무 생성, 상태 변경 등) 선택

---

## 4. 잘 안 될 때

Actions 탭 → **Jira Sync** 실행 기록에서 로그를 확인합니다. 노란 경고(warning)에 원인이 적혀 있습니다.

| 증상 | 원인 / 해결 |
|---|---|
| Jira 업무가 안 생김 | 종류 라벨(`feat`/`fix`/`test`/`docs`/`infra`)이 없음 → 라벨을 붙이면 다음 단계(브랜치·PR)에서 생성됩니다 |
| 브랜치를 만들었는데 반응 없음 | 브랜치 이름에 Jira 키 / 이슈 번호가 없음, 또는 기준 브랜치에 워크플로우 파일이 없음 |
| 브랜치는 됐는데 GitHub 보드만 안 바뀜 | Jira에서 직접 만든 업무라 연결된 GitHub 이슈가 없음 (`github-issue-N` 라벨 없음) |
| Epic 이 안 붙음 | `role/...` 라벨이 없거나, Jira Epic 이름이 바뀜 |
| Sprint 가 안 붙음 | Jira에 같은 `M번호.` Sprint 가 없거나 이미 종료됨 → 백로그에 남습니다 |
| `"검토 중" 로 가는 전환이 없습니다` | Jira 워크플로우에서 현재 상태 → 검토 중 전환이 막혀 있음 |
| 보드가 안 바뀜 | `GH_PROJECT_TOKEN` / `GH_PROJECT_NUMBER` 미설정 또는 토큰 권한 부족 |

### 알려진 제한

- 이슈 생성 **후에** 바꾼 제목·라벨·Milestone 은 이미 만들어진 Jira 업무에 반영되지 않습니다.
- 포크 저장소에서 온 PR은 시크릿에 접근할 수 없어 건너뜁니다.
