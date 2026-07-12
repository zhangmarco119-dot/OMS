import { chromium } from 'playwright';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { access } from 'node:fs/promises';

const baseUrl = process.env.E2E_BASE_URL || 'http://127.0.0.1:5173';
const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA || ''}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const assertText = async (page, text) => {
  const locator = page.getByText(text, { exact: true });
  await locator.waitFor({ state: 'visible', timeout: 10000 });
};

const checkServer = (url) => new Promise((resolve, reject) => {
  const parsed = new URL(url);
  const client = parsed.protocol === 'https:' ? https : http;
  const request = client.request(parsed, { method: 'GET', timeout: 5000 }, (response) => {
    response.resume();
    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) {
      resolve();
      return;
    }
    reject(new Error(`server responded ${response.statusCode}`));
  });
  request.on('error', reject);
  request.on('timeout', () => {
    request.destroy(new Error('server check timed out'));
  });
  request.end();
});

const runViewport = async (browser, viewport, label) => {
  const page = await browser.newPage({ viewport });

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${baseUrl}/login`, { timeout: 10000 });
  await assertText(page, '门店运营系统');

  await page.goto(`${baseUrl}/phase-1`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${baseUrl}/login`, { timeout: 10000 });
  await assertText(page, '门店运营系统');

  await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await assertText(page, '门店运营系统');
  await page.getByPlaceholder('请输入账号名或姓名').waitFor({ state: 'visible', timeout: 10000 });

  for (const protectedPath of [
    '/app/history',
    '/app/arrivals',
    '/app/arrivals/history',
    '/app/arrivals/00000000-0000-4000-8000-000000000001/success',
    '/app/admin/arrivals',
    '/app/admin/arrivals/summary',
    '/app/admin/arrivals/00000000-0000-4000-8000-000000000001',
    '/app/tasks',
    '/app/admin/task-templates',
    '/app/tasks/00000000-0000-4000-8000-000000000001',
    '/app/admin/tasks',
    '/app/admin/tasks/00000000-0000-4000-8000-000000000001',
  ]) {
    await page.goto(`${baseUrl}${protectedPath}`, { waitUntil: 'domcontentloaded' });
    await assertText(page, '请登录以继续');
  }

  await page.close();
  console.log(`E2E smoke passed: ${label}`);
};

const findChrome = async () => {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common Chrome path.
    }
  }
  return undefined;
};

try {
  await checkServer(baseUrl);
} catch (error) {
  console.error(`E2E server is not reachable at ${baseUrl}. Start the dev server first.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const executablePath = await findChrome();
const browser = await chromium.launch({
  executablePath,
  headless: true,
});

try {
  await runViewport(browser, { width: 1280, height: 720 }, 'desktop');
  await runViewport(browser, { width: 390, height: 844, isMobile: true }, 'mobile');
} finally {
  await browser.close();
}
