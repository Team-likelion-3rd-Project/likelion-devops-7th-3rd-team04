import { test, expect, type Page } from '@playwright/test'
import { goToOptions, signUp } from './helpers'

// R2: 재고를 잡은 뒤 예약이 실패하면, 잡은 재고가 돌아오는가?
//
// booking-service createBooking 순서 (booking-service.service.ts):
//   ① hotel-service에 재고 차감(reserveRoomAvailability)
//   ② 편의시설을 고른 경우 편의시설 조회(getFacilities) — 실패하면 503/409
//   ③ 예약 저장
// ② 이후에 실패해도 ①에서 줄인 재고를 되돌리는 코드가 보이지 않는다.
//
// 재현: ②가 실패하도록 예약 요청의 hotelId만 없는 호텔로 바꾼다.
//   객실(roomId)은 그대로라 ① 재고 차감은 성공하고, ② 편의시설 조회는 실패한다.
//   (운영에서는 hotel-service 지연·장애로 ②가 503이 되는 상황과 같은 결과)

async function remainingCount(page: Page, roomId: string, date: string): Promise<number> {
  const res = await page.request.get(
    `/api/hotels/1/rooms/${roomId}/availability?startDate=${date}&endDate=${date}`,
  )
  expect(res.ok()).toBeTruthy()
  const body = (await res.json()) as { availabilities: { remainingCount: number }[] }
  return body.availabilities[0].remainingCount
}

test('R2: 편의시설 단계에서 예약이 실패하면 남은 객실 수가 그대로여야 한다', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)

  const url = new URL(page.url())
  const roomId = url.searchParams.get('room') as string
  const checkIn = url.searchParams.get('checkIn') as string
  const before = await remainingCount(page, roomId, checkIn)

  // 편의시설(수영장 성인 1명)을 골라야 ② 단계를 지난다 — 버튼 이름은 #519(성인·소인 분리)부터 "수영장 성인"
  await page.getByRole('button', { name: '수영장 성인 증가' }).click()

  let serverStatus = 0
  await page.route('**/api/bookings', async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    const body = route.request().postDataJSON() as Record<string, unknown>
    const response = await route.fetch({ postData: JSON.stringify({ ...body, hotelId: 999999 }) })
    serverStatus = response.status()
    await route.fulfill({ response })
  })

  await page.getByRole('button', { name: '예약하기', exact: true }).click()

  // 예약은 실패하고 옵션 화면에 남는다
  await expect(page.locator('.reservation-options-pay-status.error')).toBeVisible()
  await expect(page).toHaveURL(/\/reservation\/options/)
  expect(serverStatus).toBeGreaterThanOrEqual(400)

  const after = await remainingCount(page, roomId, checkIn)
  test.info().annotations.push({
    type: 'R2 결과',
    description: `서버 응답 ${serverStatus}, 남은 객실 ${before} → ${after}`,
  })
  expect(after, '예약은 실패했는데 재고가 줄었다 (재고 누수)').toBe(before)
})
