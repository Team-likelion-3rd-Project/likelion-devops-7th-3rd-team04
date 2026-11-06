import { test, expect, type Page } from '@playwright/test'
import { goToOptions, signUp } from './helpers'

// R7: 프론트가 자동으로 다시 보내는 요청이 중복을 만들지 않는가?
//   - 429(요청 제한): Retry-After만큼 기다렸다 같은 요청을 다시 보낸다 (최대 30초, gateway.ts fetchWithRateLimitRetry)
//   - 401(토큰 만료): 토큰을 재발급한 뒤 한 번 다시 보낸다 (gateway.ts authorizedFetch)
// 둘 다 서버가 처리하기 "전에" 거절한 응답이라 다시 보내도 안전해야 한다.
//
// E2E 환경은 요청 한도를 크게 올려 두었으므로(docker-compose.e2e.yml), 429·401은 테스트가 직접 만든다.
// 첫 요청은 서버로 보내지 않고 거절 응답만 돌려준다 → 서버 입장에서는 실제 거절과 같다.

const THROTTLED = {
  status: 429,
  contentType: 'application/json',
  body: JSON.stringify({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }),
}

/** 첫 POST /api/bookings 를 서버로 보내지 않고 거절한다. 브라우저가 보낸 횟수를 돌려준다. */
async function rejectFirstCreate(page: Page, reply: Parameters<import('@playwright/test').Route['fulfill']>[0]) {
  const calls = { value: 0 }
  await page.route('**/api/bookings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    calls.value += 1
    if (calls.value === 1) return route.fulfill(reply)
    return route.continue()
  })
  return calls
}

async function pendingCount(page: Page): Promise<number> {
  await page.goto('/mypage/reservations')
  const pending = page.locator('.reservation-card', { hasText: '결제 대기' })
  await expect(pending.first()).toBeVisible()
  return pending.count()
}

test('R7: 예약 요청이 429를 받으면 기다렸다 다시 보내고, 예약은 1건', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const calls = await rejectFirstCreate(page, { ...THROTTLED, headers: { 'Retry-After': '1' } })

  await page.getByRole('button', { name: '예약하기', exact: true }).click()
  await expect(page).toHaveURL(/\/reservation\/complete\/\d+/, { timeout: 10_000 })

  expect(calls.value, '브라우저가 보낸 예약 요청 수 (거절 1 + 재전송 1)').toBe(2)
  expect(await pendingCount(page)).toBe(1)
})

test('R7: 예약 요청이 401을 받으면 토큰을 재발급해 다시 보내고, 예약은 1건', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const calls = await rejectFirstCreate(page, {
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ statusCode: 401, message: '유효하지 않은 토큰입니다.', error: 'Unauthorized' }),
  })
  const refresh = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/api/auth/refresh'))

  await page.getByRole('button', { name: '예약하기', exact: true }).click()
  await refresh
  await expect(page).toHaveURL(/\/reservation\/complete\/\d+/, { timeout: 10_000 })

  expect(calls.value, '브라우저가 보낸 예약 요청 수 (거절 1 + 재전송 1)').toBe(2)
  expect(await pendingCount(page)).toBe(1)
})

test('R7(현재 동작 기록): Retry-After가 30초보다 길면 기다리지 않고 바로 오류를 보여준다', async ({ page }) => {
  // 실제 gateway는 1분 창(ttl 60초)이라 한도를 넘으면 Retry-After가 수십 초로 온다 (11-05 실측 약 57초).
  // 프론트 대기 예산은 30초라 이 경우 재시도 없이 바로 오류 화면이 된다 → 발견 목록 2번의 근거.
  await signUp(page)
  let calls = 0
  // 예약 내역은 페이지 조회(?page=), 마이페이지 배지는 상태 조회(?status=)라 쿼리가 붙은 목록 요청을 모두 막는다
  await page.route(/\/api\/bookings\/me(\?|$)/, async (route) => {
    calls += 1
    await route.fulfill({ ...THROTTLED, headers: { 'Retry-After': '57' } })
  })

  const started = Date.now()
  await page.goto('/mypage/reservations')
  await expect(page.getByText(/불러오지 못했습니다|잠시 후 다시 시도/).first()).toBeVisible({ timeout: 10_000 })
  const waitedSec = (Date.now() - started) / 1000
  test.info().annotations.push({
    type: 'R7 결과',
    description: `Retry-After 57초 → ${waitedSec.toFixed(1)}초 만에 오류 화면, 요청 ${calls}번 (기다렸다 보낸 재시도 없음)`,
  })
  expect(waitedSec).toBeLessThan(10)
})
