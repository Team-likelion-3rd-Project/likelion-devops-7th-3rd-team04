import { test, expect, type Page } from '@playwright/test'
import { goToOptions, payWithMock, reserve, signUp } from './helpers'

// R4~R6: 같은 동작을 여러 번 했을 때 한 번만 처리되는가? (코드상 방어가 있는 곳 — 확인용)
//   R4 결제 버튼 연타 · 두 탭에서 동시에 결제
//   R5 결제 성공 화면 새로고침
//   R6 취소 버튼 연타 · 이미 취소된 예약을 다른 탭에서 다시 취소

/** 요청 수 세기: 주소가 pattern에 맞고 method가 같은 요청 */
function countRequests(page: Page, method: string, pattern: RegExp) {
  const counter = { value: 0 }
  page.on('request', (req) => {
    if (req.method() === method && pattern.test(new URL(req.url()).pathname)) counter.value += 1
  })
  return counter
}

/** 결제내역에서 그 예약의 결제 카드 상태(class 끝부분) 목록. 예: ['approved'] */
async function paymentStatuses(page: Page, reservationId: string): Promise<string[]> {
  await page.goto('/mypage/payments')
  const cards = page.locator('.payment-card', { hasText: `예약번호 ${reservationId}` })
  await expect(cards.first()).toBeVisible()
  const classes = await cards.locator('.payment-status').evaluateAll((els) => els.map((el) => el.className))
  return classes.map((c) => c.replace(/.*payment-status-/, ''))
}

const RESULT_HEADINGS = /결제가 완료되었습니다|결제에 실패했습니다|결제 확정 처리 중입니다|예약을 확정하는 중입니다/

test('R4: 결제창의 결제 버튼을 두 번 눌러도 결제 시도는 1번', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)

  const prepare = countRequests(page, 'POST', /\/payment-attempts$/)
  const confirm = countRequests(page, 'POST', /\/payment-attempts\/confirm$/)

  await page.getByRole('button', { name: '결제하기', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /원 결제하기$/ }).dblclick()
  await expect(page.getByRole('heading', { name: '결제가 완료되었습니다' })).toBeVisible({ timeout: 20_000 })

  expect(prepare.value, '결제 준비 요청 수').toBe(1)
  expect(confirm.value, '결제 승인 요청 수').toBe(1)
  expect(await paymentStatuses(page, reservationId)).toEqual(['approved'])
})

test('R4: 두 탭에서 동시에 결제해도 승인된 결제는 1건', async ({ page, context }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)

  // 같은 예약 상세 화면을 두 탭에 띄우고, 둘 다 결제창을 연다
  const tab2 = await context.newPage()
  for (const tab of [page, tab2]) {
    await tab.goto(`/mypage/reservations/${reservationId}`)
    await tab.getByRole('button', { name: '결제하기', exact: true }).click()
  }
  // 거의 동시에 누른다
  await Promise.all(
    [page, tab2].map((tab) => tab.getByRole('dialog').getByRole('button', { name: /원 결제하기$/ }).click()),
  )

  // 각 탭은 결과 화면이나 "결제할 수 없음" 안내 중 하나로 끝난다
  const outcomes: string[] = []
  for (const tab of [page, tab2]) {
    const result = tab.getByRole('heading', { name: RESULT_HEADINGS })
    const blocked = tab.getByRole('dialog').locator('p', { hasText: /결제할 수 없|확인하고 있습니다/ })
    await expect(result.or(blocked).first()).toBeVisible({ timeout: 20_000 })
    outcomes.push(((await result.or(blocked).first().textContent()) ?? '').trim())
  }

  // 결제 확정·자동 취소가 반영될 시간을 조금 준다 (대사 배치·SQS)
  await page.waitForTimeout(3_000)
  const statuses = await paymentStatuses(page, reservationId)
  test.info().annotations.push({
    type: 'R4 두 탭 결과',
    description: `탭1: ${outcomes[0]} / 탭2: ${outcomes[1]} / 결제 상태: ${statuses.join(', ')}`,
  })
  expect(statuses.filter((s) => s === 'approved'), '승인 상태로 남은 결제').toHaveLength(1)
})

test('R5: 결제 성공 화면을 새로고침해도 이중 결제가 없다', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)
  await payWithMock(page)

  const confirm = countRequests(page, 'POST', /\/payment-attempts\/confirm$/)
  await page.reload()

  // 새로고침하면 승인 요청을 다시 보내지만, 서버는 같은 결과를 돌려줘야 한다.
  // ("확정하는 중" 화면을 잠깐 거친 뒤 최종 결과로 바뀐다)
  await expect(page.getByRole('heading', { name: '결제가 완료되었습니다' })).toBeVisible({ timeout: 20_000 })
  test.info().annotations.push({ type: 'R5 결과', description: `새로고침 뒤 승인 요청 ${confirm.value}번, 결제 완료 화면` })
  expect(await paymentStatuses(page, reservationId)).toEqual(['approved'])
})

test('R6: 취소 확인 버튼을 두 번 눌러도 취소·환불은 1번', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)
  await payWithMock(page)

  const cancel = countRequests(page, 'PUT', new RegExp(`/api/bookings/${reservationId}$`))
  await page.goto(`/mypage/reservations/${reservationId}`)
  await page.getByRole('button', { name: '예약 취소', exact: true }).click()
  await page
    .getByRole('dialog', { name: '예약을 취소하시겠어요?' })
    .getByRole('button', { name: '예약 취소', exact: true })
    .dblclick()

  await expect(page.getByRole('heading', { name: '환불이 완료되었습니다' })).toBeVisible({ timeout: 35_000 })
  expect(cancel.value, '취소 요청 수').toBe(1)
  expect(await paymentStatuses(page, reservationId)).toEqual(['refunded'])
})

test('R6: 다른 탭에서 이미 취소한 예약을 다시 취소하면 안내가 나온다', async ({ page, context }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)
  await payWithMock(page)

  // 탭2는 취소 전 화면을 띄워 둔다
  const tab2 = await context.newPage()
  await tab2.goto(`/mypage/reservations/${reservationId}`)
  await expect(tab2.getByRole('button', { name: '예약 취소', exact: true })).toBeVisible()

  // 탭1에서 취소 → 환불 완료
  await page.goto(`/mypage/reservations/${reservationId}`)
  await page.getByRole('button', { name: '예약 취소', exact: true }).click()
  await page
    .getByRole('dialog', { name: '예약을 취소하시겠어요?' })
    .getByRole('button', { name: '예약 취소', exact: true })
    .click()
  await expect(page.getByRole('heading', { name: '환불이 완료되었습니다' })).toBeVisible({ timeout: 35_000 })

  // 탭2(오래된 화면)에서 다시 취소 → 409 안내 (ALREADY_REFUNDED)
  await tab2.getByRole('button', { name: '예약 취소', exact: true }).click()
  const dialog = tab2.getByRole('dialog', { name: '예약을 취소하시겠어요?' })
  await dialog.getByRole('button', { name: '예약 취소', exact: true }).click()
  await expect(dialog.getByText('이미 취소되고 환불이 완료된 예약입니다.')).toBeVisible()

  expect(await paymentStatuses(page, reservationId)).toEqual(['refunded'])
})
