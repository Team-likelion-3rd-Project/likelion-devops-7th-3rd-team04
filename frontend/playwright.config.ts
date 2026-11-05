import { defineConfig, devices } from '@playwright/test'

// E2E 테스트 설정 (LDP-232)
// - 화면: E2E 전용 Vite 개발 서버(localhost:5174)를 테스트가 직접 띄운다.
//   평소 쓰는 5173(토스 모드일 수 있음)과 섞이지 않게 포트를 나누고, 결제는 MOCK으로 고정한다.
// - 백엔드: 로컬 docker compose(api-gateway localhost:3000)를 먼저 띄워 둔다. 결제 MOCK 덮어쓰기 포함:
//   docker compose -f docker-compose.yml -f docker-compose.e2e.yml --profile local-infra up -d --build
// - 운영 서버에는 돌리지 않는다. 장애 주입(503 응답 바꾸기 등)을 하기 때문이다.
const E2E_PORT = 5174
const BASE_URL = `http://localhost:${E2E_PORT}`
const API_TARGET = process.env.E2E_API_TARGET ?? 'http://localhost:3000'

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
    command: `npm run dev -- --port ${E2E_PORT} --strictPort`,
    url: BASE_URL,
    // 실행 중인 환경변수가 .env.development.local 보다 우선한다 (Vite 규칙)
    env: {
      VITE_DEV_API_PROXY: API_TARGET,
      VITE_PAYMENT_MODE: 'MOCK',
      VITE_PAYMENT_FAKE_RESULT: '',
      VITE_ROOM_UNIT_FAKE: '',
    },
    // 테스트를 여러 번 돌릴 때 이미 떠 있는 E2E 서버(5174)는 다시 쓴다.
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
