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
