import { test, expect } from '@playwright/test'

// These browser tests exercise UI state and layout with an explicit API fixture.
// Real Supabase/Gemini persistence is covered by the opt-in backend integration suite.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const user = {
      id: '10000000-0000-0000-0000-000000000001',
      email: 'fixture@example.invalid',
      aud: 'authenticated',
      role: 'authenticated',
    }
    const token =
      btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) +
      '.' +
      btoa(
        JSON.stringify({
          sub: user.id,
          exp: Math.floor(Date.now() / 1000) + 3600,
        }),
      ) +
      '.fixture-signature'
    localStorage.setItem(
      'sb-ngfqtzwksapqedvnylxd-auth-token',
      JSON.stringify({
        access_token: token,
        refresh_token: 'fixture-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'bearer',
        user,
      }),
    )
  })
  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({
      json: {
        id: '10000000-0000-0000-0000-000000000001',
        email: 'fixture@example.invalid',
        role: 'authenticated',
      },
    }),
  )
})

for (const width of [1440, 390, 375, 812]) {
  test(`notebook journey and layout at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width, height: width === 812 ? 375 : 1000 })
    if (width === 375) await page.emulateMedia({ reducedMotion: 'reduce' })
    let notebook: { id: string; title: string; deleting: boolean } | null = null
    let uploaded = false,
      ready = false,
      learned = false
    const source = {
      chunk_id: 'chunk-1',
      document_id: 'doc-1',
      filename: 'cedar.txt',
      page_number: null,
      content: 'The Cedar library lends three books for fourteen days.',
    }
    const turns: {
      id: string
      question: string
      answer: string
      sources: (typeof source)[]
    }[] = []
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        json: {
          id: '10000000-0000-0000-0000-000000000001',
          email: 'fixture@example.invalid',
        },
      }),
    )
    await page.route(/\/api\/notebooks(?:\/|\?|$)/, async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        method = request.method()
      const path = url.pathname.replace('/api/notebooks', '')
      if (path === '' && method === 'POST') {
        notebook = {
          id: 'notebook-1',
          title: request.postDataJSON().title,
          deleting: false,
        }
        return route.fulfill({ status: 201, json: notebook })
      }
      if (path === '')
        return route.fulfill({
          json: notebook ? [{ ...notebook, xp: learned ? 100 : 0 }] : [],
        })
      if (path.endsWith('/documents')) {
        uploaded = true
        return route.fulfill({ status: 202, json: { id: 'doc-1' } })
      }
      if (path.endsWith('/questions')) {
        const data = request.postDataJSON()
        turns.push({
          id: data.id,
          question: data.question,
          answer: 'Members may borrow three books for fourteen days.',
          sources: [source],
        })
        return route.fulfill({ json: turns.at(-1) })
      }
      if (path.endsWith('/progress')) {
        learned = request.postDataJSON().learned
        return route.fulfill({ json: { learned } })
      }
      if (path.endsWith('/practice')) {
        return route.fulfill({
          json: {
            mind_map: {
              title: 'Library membership',
              branches: [
                {
                  label: 'Borrowing',
                  relation: 'Membership grants borrowing privileges.',
                  concepts: ['Loan duration', 'Borrowing limit'],
                  source,
                },
                {
                  label: 'Returns',
                  relation: 'Members return books by the due date.',
                  concepts: ['Due date'],
                  source,
                },
              ],
            },
            flashcards: [
              {
                prompt: 'How long is a loan?',
                answer: 'Fourteen days.',
                source,
              },
            ],
            quiz: Array.from({ length: 20 }, (_, i) => ({
              prompt: `What is the loan period? (${i + 1})`,
              options: [
                'Seven days',
                'Fourteen days',
                'Thirty days from the date the library confirms the loan',
              ],
              correct_index: 1,
              answer: 'The lending policy says fourteen days.',
              source,
            })),
          },
        })
      }
      if (path.endsWith('/file'))
        return route.fulfill({
          contentType: 'text/plain',
          body: source.content,
        })
      if (method === 'PATCH') {
        notebook!.title = request.postDataJSON().title
        return route.fulfill({ json: notebook })
      }
      if (method === 'DELETE') {
        notebook = null
        return route.fulfill({ json: { deleted: true } })
      }
      return route.fulfill({
        json: {
          notebook,
          turns,
          documents: uploaded
            ? [
                {
                  id: 'doc-1',
                  filename: 'cedar.txt',
                  kind: 'txt',
                  status: ready ? 'ready' : 'processing',
                  phase: ready ? 'ready' : 'indexing',
                  completed_chunks: ready ? 2 : 1,
                  total_chunks: 2,
                  warnings: [],
                  materials: ready
                    ? [
                        {
                          title: 'Study guide 1',
                          answer:
                            'Introduction\nThe library lends books.\n\nMain topics\nBorrowing limits and return dates.\n\nSource-supported examples\nA member can borrow three books for fourteen days.',
                          sources: [source],
                          topics: [
                            {
                              title: 'Borrowing limits',
                              answer: 'A member can borrow three books.',
                              sources: [source],
                            },
                            {
                              title: 'Return dates',
                              answer: 'Books are due in fourteen days.',
                              sources: [source],
                            },
                          ],
                        },
                        {
                          title: 'Review',
                          answer: 'Recall the borrowing limit.',
                          sources: [source],
                        },
                      ]
                    : [],
                  learned,
                  page_count: null,
                },
              ]
            : [],
        },
      })
    })
    await page.goto('/')
    const workspaceNav = page.getByRole('navigation', {
      name: 'Jump to workspace section',
    })
    await expect(
      workspaceNav.getByRole('link', { name: 'Lesson' }),
    ).toHaveCount(0)
    await workspaceNav.getByRole('link', { name: 'Library' }).press('Enter')
    await expect(page.locator('#notebook-library')).toBeFocused()
    await page.getByLabel('New notebook name').fill('Everyday discoveries')
    await page.getByRole('button', { name: 'Create notebook' }).click()
    await expect(
      page.getByRole('heading', { name: 'Everyday discoveries' }),
    ).toBeVisible()
    await page.getByLabel('Upload PDF or TXT').setInputFiles({
      name: 'cedar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(source.content),
    })
    await expect(
      page.getByRole('progressbar', { name: 'Indexing cedar.txt' }),
    ).toHaveAttribute('value', '1')
    await expect(
      page.getByRole('button', { name: /Ask question/ }),
    ).toBeDisabled()
    ready = true
    const trail = page.getByRole('navigation', { name: 'Chapter landmarks' })
    await expect(
      trail.getByRole('button', { name: /Study guide 1/ }),
    ).toBeVisible({
      timeout: 12000,
    })
    const lesson = page.locator('.lesson-copy')
    await expect(lesson).toHaveText('A member can borrow three books.')
    await workspaceNav.getByRole('link', { name: 'Lesson' }).click()
    await expect(page.locator('#lesson-reader')).toBeFocused()
    await workspaceNav.getByRole('link', { name: 'Questions' }).press('Enter')
    await expect(page.locator('#source-questions')).toBeFocused()
    await page.getByRole('button', { name: /Next topic/ }).click()
    await expect(
      page.getByText('Books are due in fourteen days.'),
    ).toBeVisible()
    await expect(
      lesson.getByText('A member can borrow three books.', { exact: true }),
    ).toHaveCount(0)
    const challenge = page.getByRole('region', { name: 'Trail challenge' })
    await page.getByRole('link', { name: 'Go to challenge' }).click()
    await expect(challenge).toBeFocused()
    await challenge
      .getByRole('button', { name: 'Return dates', exact: true })
      .click()
    await expect(challenge.getByRole('status')).toContainText('Try again')
    await challenge.getByRole('button', { name: 'Open source hint' }).click()
    await expect(
      page.getByRole('region', { name: 'Cited source passage' }),
    ).toContainText(source.content)
    await challenge
      .getByRole('button', { name: 'Borrowing limits', exact: true })
      .click()
    await expect(challenge.getByRole('status')).toContainText('Stamp earned')
    await expect(
      trail.getByRole('button', { name: /Study guide 1 Stamped/ }),
    ).toBeVisible()
    const practice = page.getByRole('region', { name: 'Source practice' })
    if (width === 1440 || width === 390) {
      await practice
        .getByRole('button', { name: 'Generate study tools' })
        .click()
      const mindMap = practice.getByRole('region', { name: 'Mind map' })
      await expect(mindMap.getByText('Library membership')).toBeVisible()
      await expect(mindMap.getByText('Loan duration')).toBeHidden()
      await mindMap.getByText('Borrowing', { exact: true }).click()
      await expect(mindMap.getByText('Loan duration')).toBeVisible()
      await mindMap
        .getByRole('button', { name: 'Read source 1: cedar.txt' })
        .click()
      await expect(
        page.getByRole('region', { name: 'Cited source passage' }),
      ).toContainText(source.content)
      await mindMap.screenshot({
        path: testInfo.outputPath(`mind-map-${width}.png`),
      })
    }
    if (width === 1440) {
      await practice.getByRole('button', { name: 'Reveal answer' }).click()
      await expect(
        practice.getByText('Fourteen days.', { exact: true }),
      ).toBeVisible()
    }
    await trail.getByRole('button', { name: 'Observatory Final quiz' }).click()
    const quiz = page.getByRole('region', { name: 'Final quiz' })
    await expect(quiz).toBeVisible()
    if (width !== 1440 && width !== 390) {
      await quiz.getByRole('button', { name: 'Generate final quiz' }).click()
    }
    await quiz.getByRole('button', { name: 'Start final quiz' }).click()
    await expect(
      quiz.getByRole('heading', { name: 'Question 1 of 20' }),
    ).toBeFocused()
    const interior = quiz.locator('.observatory-interior')
    await expect(interior).toHaveCSS(
      'animation-name',
      width === 375 ? 'none' : 'observatory-arrival',
    )
    await expect(interior).toHaveCSS('opacity', '1')
    await quiz.getByRole('button', { name: 'Replay entrance' }).click()
    await expect(
      quiz.getByRole('heading', { name: 'Question 1 of 20' }),
    ).toBeVisible()
    await expect(interior).toHaveCSS('opacity', '1')
    const longAnswer = quiz.getByText(/Thirty days from the date/)
    const option = quiz.getByRole('radio', {
      name: /Thirty days from the date/,
    })
    await expect(option).toHaveCSS('width', '18px')
    expect((await longAnswer.boundingBox())!.width).toBeGreaterThan(100)
    await expect(quiz.locator('form')).toHaveCSS(
      'animation-name',
      width === 375 ? 'none' : 'page-in',
    )
    await quiz.getByRole('radio', { name: 'Seven days' }).check()
    await quiz.getByRole('button', { name: 'Check answer' }).click()
    await expect(quiz.getByRole('status')).toContainText(
      'Correct answer: Fourteen days.',
    )
    await expect(quiz.locator('label[data-result="Incorrect"]')).toHaveCSS(
      'background-color',
      'rgb(251, 234, 225)',
    )
    const correctAnswer = quiz.locator('label[data-result="Correct"]')
    await expect(correctAnswer).toContainText('Fourteen days')
    await expect(correctAnswer).toHaveCSS(
      'background-color',
      'rgb(220, 231, 217)',
    )
    if (width === 1440 || width === 390) {
      await quiz.screenshot({
        path: testInfo.outputPath(`final-quiz-${width}.png`),
        animations: 'disabled',
      })
    }
    if (width === 1440) {
      for (let i = 2; i <= 20; i++) {
        await quiz.getByRole('button', { name: 'Next question' }).click()
        await quiz.getByRole('radio', { name: 'Fourteen days' }).check()
        await quiz.getByRole('button', { name: 'Check answer' }).click()
      }
      await expect(correctAnswer.getByRole('radio')).toBeChecked()
      await expect(quiz.locator('label[data-result="Incorrect"]')).toHaveCount(
        0,
      )
      await expect(
        trail.getByRole('button', { name: 'Observatory Final quiz' }),
      ).toBeVisible()
      await quiz.getByRole('button', { name: 'Finish quiz' }).click()
      await expect(
        quiz.getByRole('heading', { name: 'Quest complete' }),
      ).toBeVisible()
      await expect(
        quiz.getByRole('heading', { name: 'Score: 19 / 20' }),
      ).toBeFocused()
    }
    await page
      .getByLabel('Ask your sources')
      .fill('How many books can I borrow?')
    await page.getByRole('button', { name: /Ask question/ }).click()
    await expect(
      page.getByText('Members may borrow three books for fourteen days.'),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Read source 1: cedar.txt' })
      .first()
      .click()
    await expect(
      page.getByRole('region', { name: 'Cited source passage' }),
    ).toContainText(source.content)
    await page.getByLabel('I have reviewed this source').click()
    await expect(page.getByLabel('I have reviewed this source')).toBeChecked()
    await expect(page.getByText('+100 XP', { exact: true })).toBeVisible()
    await page.reload()
    await expect(
      page.getByText('Members may borrow three books for fourteen days.'),
    ).toBeVisible()
    await expect(page.getByLabel('I have reviewed this source')).toBeChecked()
    await expect(
      trail.getByRole('button', { name: /Study guide 1 Stamped/ }),
    ).toBeVisible()
    await trail.evaluate(async (element) => {
      const url =
        getComputedStyle(element).backgroundImage.match(/url\("([^"]+)"\)/)?.[1]
      if (!url) throw new Error('Quest illustration is missing')
      const illustration = new Image()
      illustration.src = url
      await illustration.decode()
    })
    await page.screenshot({
      path: testInfo.outputPath(`notebook-${width}.png`),
      fullPage: true,
    })
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true)
    if (width === 1440) {
      await page.getByRole('link', { name: 'My account' }).click()
      await expect(
        page.getByRole('heading', { name: 'My account' }),
      ).toBeVisible()
      await expect(page.getByText('Account verified')).toBeVisible()
      await expect(page.locator('.journal-xp')).toHaveText('100 XP')
      await page.screenshot({ path: testInfo.outputPath('account.png') })
      await page.getByRole('link', { name: /Everyday discoveries/ }).click()
    }
    await page.getByText('Notebook settings').click()
    await page
      .getByLabel('Notebook name', { exact: true })
      .fill('Renamed discoveries')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Renamed discoveries' }),
    ).toBeVisible()
    page.once('dialog', (dialog) => dialog.accept())
    await page
      .getByRole('button', { name: 'Delete notebook', exact: true })
      .click()
    await expect(
      page.getByRole('heading', { name: 'Start your expedition.' }),
    ).toBeVisible()
    expect(errors).toEqual([])
  })
}
