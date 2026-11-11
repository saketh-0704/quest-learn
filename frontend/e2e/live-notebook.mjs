// Explicitly invoked by backend/scripts/browser_notebook_smoke.py; no API mocks.
import { chromium } from '../node_modules/@playwright/test/index.mjs'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'chrome' })
let page
process.exitCode = 1
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/login')
  await page.getByLabel('Email address').fill(process.env.NOTEBOOK_TEST_EMAIL)
  await page.getByLabel('Password', { exact: true }).fill(process.env.NOTEBOOK_TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByLabel('New notebook name').fill('Live PDF verification')
  await page.getByRole('button', { name: 'Create notebook' }).click()
  await page.getByLabel('Upload PDF or TXT').setInputFiles(fileURLToPath(new URL('../../backend/tests/fixtures/cedar.pdf', import.meta.url)))
  await page.getByText('4. Review', { exact: true }).waitFor({ timeout: 180000 })
  await page.getByLabel('Ask your sources').fill('What is the late return charge?')
  await page.getByRole('button', { name: /Ask question/ }).click()
  const conversation = page.getByLabel('Document conversation')
  await conversation.getByRole('button', { name: /cedar.pdf page 2/ }).first().waitFor({ timeout: 120000 })
  if (!/two|2/i.test(await conversation.innerText())) throw new Error('Expected source-grounded late fee')
  await conversation.getByRole('button', { name: /cedar.pdf page 2/ }).first().click()
  await page.getByRole('region', { name: 'Cited source passage' }).waitFor()
  const original = page.getByRole('link', { name: /Open original.*page 2/ })
  await original.waitFor({ timeout: 30000 })
  if (!(await original.getAttribute('href')).endsWith('#page=2')) throw new Error('PDF citation page missing')
  await page.getByLabel('I have reviewed this source').click()
  await page.waitForFunction(() => document.querySelector('.nb-reviewed input')?.checked)
  await page.reload()
  await conversation.getByRole('button', { name: /cedar.pdf page 2/ }).first().waitFor()
  await page.waitForFunction(() => document.querySelector('.nb-reviewed input')?.checked)
  await mkdir(fileURLToPath(new URL('../../.local', import.meta.url)), { recursive: true })
  await page.screenshot({ path: fileURLToPath(new URL('../../.local/live-notebook.png', import.meta.url)), fullPage: true })
  if (errors.length) throw new Error('Browser runtime errors occurred')
  console.log('PASS: real sign-in, notebook creation, private PDF upload, background processing, Gemini chat, page citation, and refresh persistence.')
  process.exitCode = 0
} finally {
  // Chrome shutdown can stall on Windows; assertion failures must still exit unsuccessfully.
  const shutdown = setTimeout(() => process.exit(process.exitCode ?? 1), 5000)
  shutdown.unref()
  await page?.close()
  await browser.close()
  clearTimeout(shutdown)
}
process.exit(0)
