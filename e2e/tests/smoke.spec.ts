import { test, expect } from '@playwright/test'

// 첫 확인용: 화면이 뜨는지만 본다 (백엔드 없이도 통과해야 한다).
test('메인 화면이 열린다', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/머묾/)
})
