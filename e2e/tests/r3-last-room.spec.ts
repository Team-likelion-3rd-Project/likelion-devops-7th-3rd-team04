import { randomUUID } from 'node:crypto'
import { test, expect, type APIRequestContext } from '@playwright/test'
import { roomSearchPath, signUp } from './helpers'

// R3: 마지막 남은 객실 1개를 여러 명이 동시에 예약하면 1명만 성공하는가?
//
// 준비: API로 다른 회원이 미리 예약해 재고를 1개만 남긴다.
// 실행: 회원 3명이 각자 브라우저에서 같은 객실 옵션 화면을 띄우고 "예약하기"를 동시에 누른다.
// 기대: 1명만 예약 완료 화면, 나머지는 409(ROOM_NOT_AVAILABLE) 안내, 남은 객실 0.
//   화면 문구는 hotel-service가 보낸 "예약 불가능한 날짜가 포함되어 있습니다."가 그대로 나온다 (11-05 확인).

const HOTEL_ID = 1 // 서울점 (주소용 이름은 seoul)
const ROOM_ID = 2
const USERS = 3

async function remaining(request: APIRequestContext, date: string): Promise<number> {
  const res = await request.get(`/api/hotels/${HOTEL_ID}/rooms/${ROOM_ID}/availability?startDate=${date}&endDate=${date}`)
  expect(res.ok()).toBeTruthy()
  return ((await res.json()) as { availabilities: { remainingCount: number }[] }).availabilities[0].remainingCount
}

/** API로 회원가입하고 액세스 토큰을 받는다 (재고를 채우는 용도) */
async function apiSignUp(request: APIRequestContext): Promise<string> {
  const id = randomUUID().slice(0, 8)
  const res = await request.post('/api/auth/register', {
    data: {
      email: `e2e-fill-${id}@example.com`,
      password: `E2e-${randomUUID()}`,
      name: `E2E fill ${id}`,
      phoneNumber: '010-0000-0000',
    },
  })
  expect(res.status()).toBe(201)
  return ((await res.json()) as { accessToken: string }).accessToken
}

test('R3: 마지막 객실 1개를 3명이 동시에 예약하면 1명만 성공한다', async ({ browser, request }, testInfo) => {
  const search = new URL(roomSearchPath('seoul'), 'http://x')
  const checkIn = search.searchParams.get('checkIn') as string
  const checkOut = search.searchParams.get('checkOut') as string

  // 1) 재고를 1개만 남긴다
  const token = await apiSignUp(request)
  const start = await remaining(request, checkIn)
  for (let i = 0; i < start - 1; i++) {
    const res = await request.post('/api/bookings', {
      headers: { Authorization: `Bearer ${token}` },
      data: { roomId: ROOM_ID, hotelId: HOTEL_ID, checkInDate: checkIn, checkOutDate: checkOut, guestCount: 2 },
    })
    expect(res.status()).toBe(201)
  }
  expect(await remaining(request, checkIn)).toBe(1)

  // 2) 회원 3명이 각자 브라우저(쿠키 분리)에서 같은 객실 옵션 화면을 띄운다
  search.searchParams.set('room', String(ROOM_ID))
  const optionsPath = `/reservation/options?${search.searchParams.toString()}`
  const baseURL = testInfo.project.use.baseURL
  const pages = []
  const statuses = new Map<number, number>()
  for (let i = 0; i < USERS; i++) {
    const context = await browser.newContext({ baseURL })
    const page = await context.newPage()
    page.on('response', (res) => {
      if (res.request().method() === 'POST' && new URL(res.url()).pathname === '/api/bookings') statuses.set(i, res.status())
    })
    await signUp(page)
    await page.goto(optionsPath)
    await expect(page.getByRole('button', { name: '예약하기', exact: true })).toBeEnabled()
    pages.push(page)
  }

  // 3) 동시에 누른다
  await Promise.all(pages.map((p) => p.getByRole('button', { name: '예약하기', exact: true }).click()))

  // 4) 각자 결과: 예약 완료 화면 또는 오류 문구
  const outcomes: string[] = []
  for (const [i, page] of pages.entries()) {
    const error = page.locator('.reservation-options-pay-status.error')
    await expect(page.locator('.reservation-complete-summary').or(error).first()).toBeVisible({ timeout: 15_000 })
    const ok = /\/reservation\/complete\/\d+/.test(page.url())
    outcomes.push(ok ? `성공(${statuses.get(i)})` : `실패(${statuses.get(i)}): ${(await error.textContent())?.trim()}`)
  }
  const left = await remaining(request, checkIn)
  test.info().annotations.push({ type: 'R3 결과', description: `${outcomes.join(' / ')} / 남은 객실 ${left}` })

  const codes = [...statuses.values()]
  expect(codes.filter((c) => c === 201), '예약에 성공한 사람 수').toHaveLength(1)
  expect(codes.filter((c) => c === 409), '매진 안내(409)를 받은 사람 수').toHaveLength(USERS - 1)
  expect(left).toBe(0)

  for (const page of pages) await page.context().close()
})
