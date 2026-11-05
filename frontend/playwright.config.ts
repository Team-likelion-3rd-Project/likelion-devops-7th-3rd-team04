import { defineConfig, devices } from '@playwright/test'

// E2E 테스트 설정 (LDP-232)
// - 화면: Vite 개발 서버(localhost:5173). 없으면 테스트가 `npm run dev`로 띄운다.
// - 백엔드: 로컬 docker compose(api-gateway localhost:3000)를 먼저 띄워 둔다.
//   Vite가 /api 를 .env.development.local 의 VITE_DEV_API_PROXY 로 넘긴다.
// - 운영 서버에는 돌리지 않는다. 장애 주입(503 응답 바꾸기 등)을 하기 때문이다.
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: './e2e',
  // 예약·재고처럼 같은 DB를 쓰는 테스트가 서로 영향을 주지 않도록 하나씩 순서대로 돌린다.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    // 실패한 테스트만 기록을 남긴다 → npx playwright show-report 로 확인
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    // 이미 npm run dev 를 켜 두었다면 그걸 쓴다.
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
