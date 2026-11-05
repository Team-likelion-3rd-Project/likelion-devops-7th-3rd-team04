import { randomUUID } from 'node:crypto'
import { test, expect, type Page } from '@playwright/test'

// 정상 흐름: 회원가입 → 객실 선택 → 예약 생성 → 결제(MOCK) → 예약 확정 → 마이페이지 확인
// 계정은 매번 새로 만든다 (비밀번호를 파일에 두지 않고, 이전 실행의 예약과 섞이지 않게).

function isoDate(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

async function signUp(page: Page) {
  const id = randomUUID().slice(0, 8)
  const phoneTail = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')

  await page.goto('/signup')
  await page.getByLabel('이름').fill(`E2E ${id}`)
  await page.getByLabel('이메일').fill(`e2e-${id}@example.com`)
  await page.getByLabel('휴대폰 번호').fill(`010-${phoneTail.slice(0, 4)}-${phoneTail.slice(4)}`)
  // 실행마다 새로 만드는 테스트 전용 값이다 (실제 계정 아님)
  const password = `E2e-${randomUUID()}`
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입', exact: true }).click()

  // 가입에 성공하면 회원가입 화면을 벗어난다 (가입 = 로그인 상태)
  await expect(page).not.toHaveURL(/\/signup/)
}

test('회원가입부터 결제 후 예약 확정까지', async ({ page }) => {
  await signUp(page)

  // 다른 실행과 날짜가 겹쳐 재고가 줄지 않도록 60~260일 뒤의 1박을 고른다
  const offset = 60 + Math.floor(Math.random() * 200)
  const params = new URLSearchParams({
    hotel: 'seoul',
    checkIn: isoDate(offset),
    checkOut: isoDate(offset + 1),
    rooms: JSON.stringify([{ adults: 2, children: 0, infants: 0 }]),
  })

  // 1) 객실 선택: 매진이 아닌 첫 객실
  await page.goto(`/reservation/rooms?${params.toString()}`)
  await page.getByRole('button', { name: '선택', exact: true }).first().click()

  // 2) 옵션 화면에서 예약하기 → 예약 완료 화면(결제 대기)
  await expect(page).toHaveURL(/\/reservation\/options/)
  await page.getByRole('button', { name: '예약하기', exact: true }).click()
  await expect(page).toHaveURL(/\/reservation\/complete\/\d+/)
  const reservationId = page.url().match(/\/reservation\/complete\/(\d+)/)?.[1]
  expect(reservationId).toBeTruthy()

  // 3) 결제(MOCK): 결제하기 → 결제창의 "OOO원 결제하기"
  await page.getByRole('button', { name: '결제하기', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /원 결제하기$/ }).click()

  // 4) 결과 화면: 승인 → SQS → booking-service 확정까지 기다린다
  await expect(page.getByRole('heading', { name: '결제가 완료되었습니다' })).toBeVisible({ timeout: 20_000 })

  // 5) 마이페이지 예약 내역에 "예약 확정"으로 보인다
  await page.goto('/mypage/reservations')
  const card = page.locator('.reservation-card', { hasText: `예약번호 ${reservationId}` })
  await expect(card).toBeVisible()
  await expect(card).toContainText('예약 확정')
})
