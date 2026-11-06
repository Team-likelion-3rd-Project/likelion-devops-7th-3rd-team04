import { test, expect } from '@playwright/test'
import { adminLogin, isoDate, signUp } from './helpers'

// R1-관리자 (LDP-243): 대리 예약 요청이 503으로 끝난 뒤 다시 누르면 예약이 두 번 생기는가?
//
// 손님 예약(R1)과 같은 상황: gateway의 gRPC 기한이 지나 직원 화면은 503을 받지만,
// booking-service는 뒤에서 계속 처리해 예약을 만든다. 폼 버튼은 실패하면 다시 눌린다.
// 폼이 멱등 키를 보내면, 다시 누른 요청에 서버가 처음 만든 예약을 돌려줘야 한다.
//
// 재현: 첫 POST /api/bookings/admin 은 서버로 그대로 보내고(예약 생성됨), 브라우저에는 503만 돌려준다.
// 손님과 관리자는 쿠키가 섞이지 않게 브라우저 컨텍스트를 따로 쓴다.

test('R1-관리자: 대리 예약이 503으로 끝난 뒤 다시 눌러도 예약은 1건이어야 한다', async ({ page, browser }, testInfo) => {
  const guest = await signUp(page)

  const adminContext = await browser.newContext({ baseURL: testInfo.project.use.baseURL })
  const admin = await adminContext.newPage()
  await adminLogin(admin)

  let createCalls = 0
  const idempotencyKeys: (string | undefined)[] = []
  await admin.route('**/api/bookings/admin', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    createCalls += 1
    idempotencyKeys.push(route.request().headers()['idempotency-key'])
    if (createCalls > 1) return route.continue()

    // 서버로는 실제로 보낸다 → 대리 예약이 만들어진다
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
        message: '예약을 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        retryable: true,
      }),
    })
  })

  await admin.goto('/admin/reservations')
  await admin.getByRole('button', { name: '대리 예약 만들기', exact: true }).first().click()

  const form = admin.locator('form.admin-form')
  await form.getByLabel('회원 검색 (이름·이메일·전화번호)').fill(guest.email)
  // <label><span>회원</span><select/></label> 구조라 span 글자로 찾는다 (admin-basic.spec.ts와 같음)
  const userSelect = form.locator('label', { has: admin.locator('span', { hasText: /^회원$/ }) }).locator('select')
  await expect(userSelect.locator('option', { hasText: guest.email })).toHaveCount(1)
  await userSelect.selectOption({ label: `${guest.name} · ${guest.email}` })
  await form.getByLabel('지점').selectOption({ label: '서울점' })
  await form.getByLabel('객실 종류').selectOption({ index: 1 })
  const offset = 60 + Math.floor(Math.random() * 200)
  await form.getByLabel('체크인').fill(isoDate(offset))
  await form.getByLabel('체크아웃').fill(isoDate(offset + 1))
  await form.getByLabel('투숙 인원').fill('2')

  // 1) 첫 클릭: 폼에 오류가 뜨고, 버튼은 다시 눌리는 상태가 된다
  const submit = form.getByRole('button', { name: '대리 예약 만들기', exact: true })
  await submit.click()
  // 503이면 화면은 자체 문구("… 잠시 후 다시 시도해 주세요.")를 보여 준다 — 문구 자체는 이 테스트의 관심이 아니다
  await expect(form.getByText(/잠시 후 다시 시도해 주세요/)).toBeVisible()
  await expect(submit).toBeEnabled()

  // 2) 직원이 같은 내용으로 다시 누른다 → 이번엔 정상 응답
  await submit.click()
  const notice = admin.locator('.admin-state.is-success')
  await expect(notice).toContainText('대리 예약 #')
  expect(createCalls).toBe(2)
  // 다시 누른 요청도 같은 멱등 키를 보낸다 → 서버가 처음 만든 예약을 돌려준다
  expect(idempotencyKeys[0]).toBeTruthy()
  expect(idempotencyKeys[1]).toBe(idempotencyKeys[0])

  // 3) 새 회원이라 손님 예약 목록의 "결제 대기"는 모두 이 테스트가 만든 것이다
  await page.goto('/mypage/reservations')
  const pending = page.locator('.reservation-card', { hasText: '결제 대기' })
  await expect(pending.first()).toBeVisible()
  const count = await pending.count()
  test.info().annotations.push({ type: 'R1-관리자 결과', description: `결제 대기 예약 ${count}건 (바라는 값 1건)` })
  expect(count, '같은 대리 예약이 중복 생성됨').toBe(1)

  await adminContext.close()
})
