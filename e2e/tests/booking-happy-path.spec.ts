import { test, expect } from '@playwright/test'
import { goToOptions, payWithMock, reservationCard, reserve, signUp } from './helpers'

// 정상 흐름. 계정은 매번 새로 만든다 (비밀번호를 파일에 두지 않고, 이전 실행의 예약과 섞이지 않게).

test('회원가입부터 결제 후 예약 확정까지', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)
  await payWithMock(page)

  // 마이페이지 예약 내역에 "예약 확정"으로 보인다
  await page.goto('/mypage/reservations')
  const card = reservationCard(page, reservationId)
  await expect(card).toBeVisible()
  await expect(card).toContainText('예약 확정')
})

test('결제한 예약을 취소하면 환불이 완료된다', async ({ page }) => {
  await signUp(page)
  await goToOptions(page)
  const reservationId = await reserve(page)
  await payWithMock(page)

  // 예약 상세 → 예약 취소 → 확인 창의 예약 취소
  await page.goto(`/mypage/reservations/${reservationId}`)
  await page.getByRole('button', { name: '예약 취소', exact: true }).click()
  const confirm = page.getByRole('dialog', { name: '예약을 취소하시겠어요?' })
  await confirm.getByRole('button', { name: '예약 취소', exact: true }).click()

  // 환불은 결제 서버에서 비동기로 진행된다 (화면은 2초 간격으로 최대 30초 확인)
  await expect(page.getByRole('heading', { name: '환불이 완료되었습니다' })).toBeVisible({ timeout: 35_000 })

  // 예약 목록에는 "취소됨"으로 보인다
  await page.goto('/mypage/reservations')
  await expect(reservationCard(page, reservationId)).toContainText('취소됨')
})
