import { test, expect } from '@playwright/test'

test('guests must sign in before app access or document selection', async ({
  page,
}) => {
  let uploads = 0
  await page.route('**/api/learning/document', async (route) => {
    uploads++
    await route.abort()
  })
  for (const path of ['/', '/new?mode=document', '/workspace']) {
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
    await expect(
      page.getByRole('heading', { name: 'Welcome back.' }),
    ).toBeVisible()
    await expect(page.getByLabel('Choose study material')).toHaveCount(0)
  }
  await page.getByRole('link', { name: 'Create an account' }).click()
  await expect(
    page.getByRole('heading', { name: 'Start your learning journey.' }),
  ).toBeVisible()
  expect(uploads).toBe(0)
})

test('Page Trail loads and respects the reduced-motion preference', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/login')

  const brand = page.getByRole('link', { name: 'QuestLearn', exact: true })
  const mark = brand.locator('img')
  await expect
    .poll(() => mark.evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0)
  const favicon = page.locator('link[rel="icon"]')
  await expect(favicon).toHaveAttribute('href', /\/questlearn\.svg$/)
  expect(await favicon.evaluate((link: HTMLLinkElement) => link.href)).toBe(
    await mark.evaluate((image: HTMLImageElement) => image.src),
  )

  await expect(mark).toHaveCSS('animation-name', 'brand-arrive')
  await brand.hover()
  await expect(mark).toHaveCSS('background-color', 'rgb(220, 231, 217)')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(mark).toHaveCSS('animation-name', 'none')
  await expect(mark).toHaveCSS('transform', 'none')
})
