import { test, expect, type Browser, type Page } from '@playwright/test'
import { adminLogin, goToOptions, isoDate, payWithMock, reservationCard, reserve, signUp } from './helpers'

// 관리자 기본 흐름: 대리 예약 · 직원 취소
// 손님과 관리자는 쿠키가 섞이지 않게 브라우저 컨텍스트를 따로 쓴다.
// 관리자 계정은 helpers.adminCredentials()가 실행할 때 읽는다 (파일에 적지 않음).

async function newPage(browser: Browser, baseURL: string | undefined): Promise<Page> {
  const context = await browser.newContext({ baseURL })
  return context.newPage()
}

test('관리자: 회원 대신 예약을 만들면 손님 예약 내역에 결제 대기로 보인다', async ({ page, browser }, testInfo) => {
  const guest = await signUp(page)

  const admin = await newPage(browser, testInfo.project.use.baseURL)
  await adminLogin(admin)
  await admin.goto('/admin/reservations')
  await admin.getByRole('button', { name: '대리 예약 만들기', exact: true }).first().click()

  const form = admin.locator('form.admin-form')
  await form.getByLabel('회원 검색 (이름·이메일·전화번호)').fill(guest.email)
  // <label><span>회원</span><select/></label> 구조라 접근성 이름에 선택된 옵션 글자까지 붙는다 → span 글자로 찾는다
  const userSelect = form.locator('label', { has: admin.locator('span', { hasText: /^회원$/ }) }).locator('select')
  await expect(userSelect.locator('option', { hasText: guest.email })).toHaveCount(1)
  await userSelect.selectOption({ label: `${guest.name} · ${guest.email}` })
  await form.getByLabel('지점').selectOption({ label: '서울점' })
  await form.getByLabel('객실 종류').selectOption({ index: 1 })
  // 다른 실행과 겹치지 않게 먼 날짜의 1박
  const offset = 60 + Math.floor(Math.random() * 200)
  await form.getByLabel('체크인').fill(isoDate(offset))
  await form.getByLabel('체크아웃').fill(isoDate(offset + 1))
  await form.getByLabel('투숙 인원').fill('2')
  await form.getByRole('button', { name: '대리 예약 만들기', exact: true }).click()

  const notice = admin.locator('.admin-state.is-success')
  await expect(notice).toContainText('대리 예약 #')
  const reservationId = (await notice.textContent())?.match(/대리 예약 #(\d+)/)?.[1] as string
  expect(reservationId).toBeTruthy()

  // 손님 화면
  await page.goto('/mypage/reservations')
  await expect(reservationCard(page, reservationId)).toContainText('결제 대기')

  await admin.context().close()
})

test('관리자: 결제된 예약을 직원 취소하면 손님에게 취소 사유와 환불이 보인다', async ({ page, browser }, testInfo) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)
  await payWithMock(page)

  const admin = await newPage(browser, testInfo.project.use.baseURL)
  await adminLogin(admin)
  await admin.goto('/admin/reservations')
  await admin.getByLabel('검색 (예약 번호·회원·호실)').fill(reservationId)
  const row = admin.locator('tr', { has: admin.locator('td', { hasText: new RegExp(`^#${reservationId}$`) }) })
  await row.getByRole('button', { name: '취소', exact: true }).click()

  const reason = `E2E 직원 취소 ${Date.now()}`
  await admin.getByLabel('취소 사유 (필수, 손님에게도 보입니다)').fill(reason)
  admin.once('dialog', (dialog) => dialog.accept()) // "취소할까요?" 확인 창
  await admin.getByRole('button', { name: '예약 취소', exact: true }).click()
  await expect(admin.locator('.admin-state.is-success')).toContainText(`예약 #${reservationId}을(를) 취소했습니다.`)

  // 손님 화면: 취소됨 + 호텔에서 취소한 사유
  await page.goto(`/mypage/reservations/${reservationId}`)
  await expect(page.getByText(`호텔에서 취소: ${reason}`)).toBeVisible()
  await page.goto('/mypage/reservations')
  await expect(reservationCard(page, reservationId)).toContainText('취소됨')

  // 환불: 결제 서버가 비동기로 처리하므로 잠깐 기다리며 확인
  await expect(async () => {
    await page.goto('/mypage/payments')
    const card = page.locator('.payment-card', { hasText: `예약번호 ${reservationId}` })
    await expect(card.locator('.payment-status')).toHaveClass(/payment-status-refunded/, { timeout: 1_000 })
  }).toPass({ timeout: 30_000 })

  await admin.context().close()
})
