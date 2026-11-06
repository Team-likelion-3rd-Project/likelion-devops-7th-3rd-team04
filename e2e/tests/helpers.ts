import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page } from '@playwright/test'

// 여러 시나리오가 같이 쓰는 단계들

export function isoDate(daysFromToday: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromToday)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** 새 회원으로 가입한다. 가입하면 바로 로그인 상태가 된다. 만든 회원의 이름·이메일을 돌려준다. */
export async function signUp(page: Page): Promise<{ name: string; email: string }> {
  const id = randomUUID().slice(0, 8)
  const phoneTail = String(Math.floor(Math.random() * 1e8)).padStart(8, '0')

  await page.goto('/signup')
  const name = `E2E ${id}`
  const email = `e2e-${id}@example.com`
  await page.getByLabel('이름').fill(name)
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('휴대폰 번호').fill(`010-${phoneTail.slice(0, 4)}-${phoneTail.slice(4)}`)
  // 실행마다 새로 만드는 테스트 전용 값이다 (실제 계정 아님)
  const password = `E2e-${randomUUID()}`
  await page.getByLabel('비밀번호', { exact: true }).fill(password)
  await page.getByLabel('비밀번호 확인').fill(password)
  await page.getByRole('button', { name: '회원가입', exact: true }).click()

  await expect(page).not.toHaveURL(/\/signup/)
  return { name, email }
}

/**
 * 객실 선택 화면의 주소. 다른 실행과 날짜가 겹쳐 재고가 줄지 않도록 60~260일 뒤의 1박을 고른다.
 */
export function roomSearchPath(hotel = 'seoul'): string {
  const offset = 60 + Math.floor(Math.random() * 200)
  const params = new URLSearchParams({
    hotel,
    checkIn: isoDate(offset),
    checkOut: isoDate(offset + 1),
    rooms: JSON.stringify([{ adults: 2, children: 0, infants: 0 }]),
  })
  return `/reservation/rooms?${params.toString()}`
}

/** 객실 선택 → 옵션 화면까지 간다 (매진이 아닌 첫 객실). */
export async function goToOptions(page: Page, searchPath = roomSearchPath()) {
  await page.goto(searchPath)
  await page.getByRole('button', { name: '선택', exact: true }).first().click()
  await expect(page).toHaveURL(/\/reservation\/options/)
}

/** 옵션 화면에서 예약하기 → 예약 완료 화면. 예약번호를 돌려준다. */
export async function reserve(page: Page): Promise<string> {
  await page.getByRole('button', { name: '예약하기', exact: true }).click()
  await expect(page).toHaveURL(/\/reservation\/complete\/\d+/)
  const reservationId = page.url().match(/\/reservation\/complete\/(\d+)/)?.[1]
  expect(reservationId).toBeTruthy()
  return reservationId as string
}

/** 예약 완료 화면에서 결제(MOCK)하고 예약 확정까지 기다린다. */
export async function payWithMock(page: Page) {
  await page.getByRole('button', { name: '결제하기', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: /원 결제하기$/ }).click()
  // 승인 → SQS → booking-service 확정까지 기다린다
  await expect(page.getByRole('heading', { name: '결제가 완료되었습니다' })).toBeVisible({ timeout: 20_000 })
}

/** 마이페이지 예약 목록에서 그 예약의 카드 */
export function reservationCard(page: Page, reservationId: string) {
  return page.locator('.reservation-card', { hasText: `예약번호 ${reservationId}` })
}

/**
 * 관리자 계정. 파일·채팅에 남기지 않도록 실행할 때 읽는다.
 *   1) 환경변수 E2E_ADMIN_EMAIL · E2E_ADMIN_PASSWORD
 *   2) 없으면 로컬 backend/.env 의 SEED_ADMIN_EMAIL · SEED_ADMIN_PASSWORD (db-seed가 만든 관리자)
 */
export function adminCredentials(): { email: string; password: string } {
  let email = process.env.E2E_ADMIN_EMAIL
  let password = process.env.E2E_ADMIN_PASSWORD
  if (!email || !password) {
    try {
      const env = readFileSync(resolve(process.cwd(), '../backend/.env'), 'utf8') // e2e/ 에서 실행하므로 ../backend
      const read = (key: string) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '')
      email ??= read('SEED_ADMIN_EMAIL')
      password ??= read('SEED_ADMIN_PASSWORD')
    } catch {
      // backend/.env가 없으면 아래에서 안내
    }
  }
  if (!email || !password) {
    throw new Error('관리자 계정이 없습니다. E2E_ADMIN_EMAIL·E2E_ADMIN_PASSWORD를 설정하거나 backend/.env의 SEED_ADMIN_*를 채워 주세요.')
  }
  return { email, password }
}

/** 관리자 화면에 로그인한다 */
export async function adminLogin(page: Page) {
  const { email, password } = adminCredentials()
  await page.goto('/admin/login')
  await page.getByLabel('이메일').fill(email)
  await page.getByLabel('비밀번호').fill(password)
  await page.getByRole('button', { name: '로그인', exact: true }).click()
  await expect(page).not.toHaveURL(/\/admin\/login/)
}
