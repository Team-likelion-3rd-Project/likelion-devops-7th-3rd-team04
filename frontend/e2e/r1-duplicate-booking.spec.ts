import { test, expect } from '@playwright/test'
import { goToOptions, signUp } from './helpers'

// R1: 예약 생성 응답이 503으로 끝난 뒤 "예약하기"를 다시 누르면 예약이 두 번 생기는가?
//
// 운영에서 생기는 상황: gateway의 gRPC 기한(기본 5초)이 지나면 사용자는 503을 받지만,
// booking-service는 뒤에서 계속 처리해 예약을 만든다. 버튼은 실패하면 다시 눌리고,
// 예약 생성 요청에는 멱등 키가 없어 서버가 두 번째 요청을 구분하지 못한다.
//
// 재현: 첫 POST /api/bookings 는 서버로 그대로 보내고(예약 생성됨), 브라우저에는 503만 돌려준다.

test('R1: 503 응답 뒤 다시 누르면 예약은 1건이어야 한다', async ({ page }) => {
  // 알려진 버그 (2026-11-05 확인: 3/3회 결제 대기 예약 2건 생성).
  // test.fail = "지금은 실패하는 게 정상"으로 표시해 전체 실행은 통과로 둔다.
  // 예약 생성 멱등 키 등으로 고쳐지면 이 테스트가 통과하면서 오히려 빨간불이 켜진다 → 그때 이 줄을 지운다.
  test.fail(true, '예약 생성에 멱등 키가 없어 503 뒤 재클릭 시 중복 예약이 생긴다')

  await signUp(page)
  await goToOptions(page)

  let createCalls = 0
  await page.route('**/api/bookings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    createCalls += 1
    if (createCalls > 1) return route.continue()

    // 서버로는 실제로 보낸다 → 예약이 만들어진다
    const real = await route.fetch()
    expect(real.status()).toBe(201)
    // 브라우저에는 gateway가 기한 초과 때 내는 응답과 같은 503을 준다
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'BOOKING_SERVICE_UNAVAILABLE',
        message: '예약 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
      }),
    })
  })

  // 1) 첫 클릭: 화면에는 오류가 뜨고, 버튼은 다시 눌리는 상태가 된다
  const reserveButton = page.getByRole('button', { name: '예약하기', exact: true })
  await reserveButton.click()
  await expect(page.getByText('예약 서비스에 연결할 수 없습니다')).toBeVisible()
  await expect(reserveButton).toBeEnabled()

  // 2) 사용자가 다시 누른다 → 이번엔 정상 응답 → 예약 완료 화면
  await reserveButton.click()
  await expect(page).toHaveURL(/\/reservation\/complete\/\d+/)
  expect(createCalls).toBe(2)

  // 3) 새 회원이라 예약 목록의 "결제 대기"는 모두 이 테스트가 만든 것이다
  await page.goto('/mypage/reservations')
  const pending = page.locator('.reservation-card', { hasText: '결제 대기' })
  await expect(pending.first()).toBeVisible()
  const count = await pending.count()
  test.info().annotations.push({ type: 'R1 결과', description: `결제 대기 예약 ${count}건 (바라는 값 1건)` })
  expect(count, '같은 객실·날짜로 결제 대기 예약이 중복 생성됨').toBe(1)
})
