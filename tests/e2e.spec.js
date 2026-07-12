const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

function findPlaywrightRoot(startPath) {
  let dir = path.dirname(startPath);
  while (dir && dir !== path.dirname(dir)) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgPath, 'utf8')).name === 'playwright') return dir;
      } catch {}
    }
    dir = path.dirname(dir);
  }
  return null;
}

let testApi;
try {
  testApi = require('@playwright/test');
} catch {
  const playwrightRoot = findPlaywrightRoot(process.argv[1]);
  testApi = require(path.join(playwrightRoot, 'test.js'));
}
const { expect, test } = testApi;

const indexUrl = pathToFileURL(path.resolve('index.html')).toString();
const STORAGE_KEY = 'daily_report_state_v5';

function makeWork(tasks) {
  return [{
    id: 101,
    category: '検証',
    tasks: tasks.map((task, index) => ({
      id: 1000 + index,
      hours: task.hours,
      name: task.name,
    })),
  }];
}

function makeState(todayTasks, tomorrowTasks = todayTasks) {
  return {
    reportWork: {
      greeting: 'お疲れ様です。退勤いたします。',
      today: makeWork(todayTasks),
      tomorrow: makeWork(tomorrowTasks),
    },
    reportPresets: ['検証'],
    tacoContacts: [],
    tacoTemplates: [{ id: 'tpl1', label: '検証', body: 'ありがとうございます' }],
    tacoBlocks: [{ id: 1, recipients: [], count: 1, body: '' }],
    tacoUsage: { date: '2026-07-07', consumed: 0, dailyLimit: 5 },
    tacoMode: 'merge',
    webhookUrl: '',
    theme: 'light',
    accentColor: '青',
  };
}

async function loadWithTasks(page, todayTasks, tomorrowTasks = todayTasks) {
  await page.goto(indexUrl);
  await page.evaluate(({ key, data }) => {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem('theme', 'light');
  }, { key: STORAGE_KEY, data: makeState(todayTasks, tomorrowTasks) });
  await page.reload();
}

async function setTotalHours(page, total, tabName = '退勤報告') {
  const task = { hours: total, name: `${tabName} 合計検証` };
  await loadWithTasks(page, [task], [task]);
  if (tabName === '朝会報告') {
    await page.getByRole('button', { name: '朝会報告', exact: true }).click();
  }
}

function hoursLocator(page) {
  return page.locator('.subheader .mono').filter({ hasText: /計 \d+(\.\d+)?h/ });
}

function hoursFrameLocator(page) {
  return page.locator('[data-role="report-hours-total"]');
}

async function readHoursStyle(page) {
  const hours = hoursLocator(page);
  await expect(hours).toBeVisible();
  return hours.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      color: style.color,
      size: parseFloat(style.fontSize),
    };
  });
}

async function readHoursFrameBox(page) {
  const frame = hoursFrameLocator(page);
  await expect(frame).toBeVisible();
  return frame.boundingBox();
}

test.describe('合計時間の固定表示と色分け', () => {
  test('合計時間は固定サブヘッダー内にありスクロールで流れない', async ({ page }) => {
    const manyTasks = Array.from({ length: 32 }, (_, index) => ({
      hours: 0.5,
      name: `スクロール検証 ${index + 1}`,
    }));
    await loadWithTasks(page, manyTasks);

    const hours = hoursLocator(page);
    await expect(hours).toBeVisible();

    const before = await hours.boundingBox();
    expect(before).not.toBeNull();

    const scrollInfo = await page.locator('[data-tab="report"] .scroll').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
      return {
        scrollTop: el.scrollTop,
        maxScrollTop: el.scrollHeight - el.clientHeight,
      };
    });
    expect(scrollInfo.maxScrollTop).toBeGreaterThan(0);

    const after = await hours.boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after.y - before.y)).toBeLessThan(2);
  });

  test('スクロール領域内に合計時間が重複表示されない', async ({ page }) => {
    await loadWithTasks(page, [{ hours: 8, name: '重複表示検証' }]);

    await expect(
      page.locator('[data-tab="report"] .scroll').getByText(/計 \d+(\.\d+)?h/)
    ).toHaveCount(0);
  });

  test('8h超=赤・大、8h未満=黄・大、8h=緑・通常', async ({ page }) => {
    for (const tabName of ['退勤報告', '朝会報告']) {
      await setTotalHours(page, 8.0, tabName);
      const green = await readHoursStyle(page);

      await setTotalHours(page, 8.5, tabName);
      const red = await readHoursStyle(page);

      await setTotalHours(page, 7.5, tabName);
      const yellow = await readHoursStyle(page);

      expect(red.color).not.toBe(green.color);
      expect(yellow.color).not.toBe(green.color);
      expect(red.color).not.toBe(yellow.color);
      expect(red.size).toBeGreaterThan(green.size);
      expect(yellow.size).toBeGreaterThan(green.size);
    }
  });

  test('文字サイズが変わっても合計時間の枠サイズは変わらない', async ({ page }) => {
    for (const tabName of ['退勤報告', '朝会報告']) {
      await setTotalHours(page, 8.0, tabName);
      const greenBox = await readHoursFrameBox(page);

      await setTotalHours(page, 8.5, tabName);
      const redBox = await readHoursFrameBox(page);

      await setTotalHours(page, 7.5, tabName);
      const yellowBox = await readHoursFrameBox(page);

      expect(greenBox).not.toBeNull();
      expect(redBox).not.toBeNull();
      expect(yellowBox).not.toBeNull();
      expect(Math.abs(redBox.height - greenBox.height)).toBeLessThan(1);
      expect(Math.abs(yellowBox.height - greenBox.height)).toBeLessThan(1);
    }
  });
});

function makeTacoState({ templateLabel, templateBody }) {
  const data = makeState([{ hours: 8, name: 'テンプレート検証' }]);
  data.tacoContacts = [{ id: 1, name: 'テストユーザー', freq: 0 }];
  data.tacoTemplates = [{ id: 'tpl1', label: templateLabel, body: templateBody }];
  data.tacoBlocks = [{
    id: 1,
    recipients: ['テストユーザー'],
    count: 1,
    body: templateBody,
  }];
  return data;
}

async function loadWithState(page, data) {
  await page.goto(indexUrl);
  await page.evaluate(({ key, storedState }) => {
    localStorage.setItem(key, JSON.stringify(storedState));
    localStorage.setItem('theme', 'light');
  }, { key: STORAGE_KEY, storedState: data });
  await page.reload();
}

async function openSettings(page) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
}

async function openTacos(page) {
  await page.locator('.nav__btn').filter({ hasText: 'タコス' }).click();
}

function templateSection(page) {
  return page.getByText('タコス テンプレート', { exact: true }).locator('..');
}

test.describe('タコステンプレート編集', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('テンプレ編集がプリフィルされる', async ({ page }) => {
    await loadWithState(page, makeTacoState({
      templateLabel: 'お礼',
      templateBody: 'レビューありがとうございました',
    }));
    await openSettings(page);

    const row = templateSection(page).locator('.tpl-row').filter({ hasText: 'お礼' });
    await row.getByRole('button', { name: '編集' }).click();

    await expect(page.locator('[data-k="edit-tpl-label-tpl1"]')).toHaveValue('お礼');
    await expect(page.locator('[data-k="edit-tpl-body-tpl1"]')).toHaveValue('レビューありがとうございました');
  });

  test('テンプレ編集が反映される', async ({ page }) => {
    await loadWithState(page, makeTacoState({
      templateLabel: 'お礼',
      templateBody: 'レビューありがとうございました',
    }));
    await openSettings(page);

    const row = templateSection(page).locator('.tpl-row').filter({ hasText: 'お礼' });
    await row.getByRole('button', { name: '編集' }).click();
    await page.locator('[data-k="edit-tpl-label-tpl1"]').fill('深い感謝');
    await page.locator('[data-k="edit-tpl-body-tpl1"]').fill('丁寧なレビューをありがとうございました');
    await templateSection(page).getByRole('button', { name: '保存' }).click();

    await expect(templateSection(page).getByText('深い感謝', { exact: true })).toBeVisible();
    await expect(templateSection(page).getByText('丁寧なレビューをありがとうございました', { exact: true })).toBeVisible();

    await page.reload();
    await openSettings(page);
    await expect(templateSection(page).getByText('深い感謝', { exact: true })).toBeVisible();
    await expect(templateSection(page).getByText('丁寧なレビューをありがとうございました', { exact: true })).toBeVisible();
  });

  test('テンプレ編集は作成済み投稿に波及しない', async ({ page }) => {
    await loadWithState(page, makeTacoState({
      templateLabel: 'お礼',
      templateBody: '作成済みの投稿本文',
    }));

    await openTacos(page);
    await expect(page.locator('.post__body')).toContainText('作成済みの投稿本文');

    await openSettings(page);
    const row = templateSection(page).locator('.tpl-row').filter({ hasText: 'お礼' });
    await row.getByRole('button', { name: '編集' }).click();
    await page.locator('[data-k="edit-tpl-body-tpl1"]').fill('編集後のテンプレート本文');
    await templateSection(page).getByRole('button', { name: '保存' }).click();

    await openTacos(page);
    await expect(page.locator('.post__body')).toContainText('作成済みの投稿本文');
    await expect(page.locator('.post__body')).not.toContainText('編集後のテンプレート本文');
  });
});

test.describe('タコス出力のメンション案内', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('プレビューとコピー出力で宛先名の前に＠や@が付かない', async ({ page }) => {
    await loadWithState(page, makeTacoState({
      templateLabel: 'お礼',
      templateBody: 'ありがとうございました',
    }));
    await openTacos(page);

    const expectedPost = 'テストユーザー\nありがとうございました\n🌮';
    const preview = page.locator('.post__body');
    await expect(preview).toHaveText(expectedPost);
    await expect(preview).not.toContainText('＠テストユーザー');
    await expect(preview).not.toContainText('@テストユーザー');

    await page.evaluate(() => {
      window.__copiedText = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
      document.execCommand = (command) => {
        if (command === 'copy') window.__copiedText = document.activeElement.value;
        return true;
      };
    });
    await page.locator('.post').getByRole('button', { name: 'コピー' }).click();

    await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe(expectedPost);
    const copiedText = await page.evaluate(() => window.__copiedText);
    expect(copiedText).not.toContain('＠テストユーザー');
    expect(copiedText).not.toContain('@テストユーザー');
  });

  test('ヒントカードが操作なしで投稿一覧の下に表示される', async ({ page }) => {
    await loadWithState(page, makeTacoState({
      templateLabel: 'お礼',
      templateBody: 'ありがとうございました',
    }));
    await openTacos(page);

    const post = page.locator('.post');
    const hint = page.getByText('Slackに貼り付けた後、各名前の前に＠を付けると一括でメンションされます。', { exact: true });
    await expect(hint).toBeVisible();

    const postBox = await post.boundingBox();
    const hintBox = await hint.boundingBox();
    expect(postBox).not.toBeNull();
    expect(hintBox).not.toBeNull();
    expect(hintBox.y).toBeGreaterThanOrEqual(postBox.y + postBox.height);
  });
});
