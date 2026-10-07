/* global window, document, localStorage, Image, Blob */
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, request } from 'playwright';

const adb = (...args) => execFileSync(process.env.ADB_PATH || 'adb', args, { encoding: 'utf8', timeout: 30_000 }).trim();
const results = [];
const report = (name) => { results.push(name); console.log(`PASS: ${name}`); };
const base = 'https://oms-store-development.pages.dev';
const project = 'tpbjlzmxpxsydsheeswm';
const apiBase = `https://${project}.supabase.co`;
const directory = 'test-results/android';
mkdirSync(directory, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const api = await request.newContext({ proxy });
let adminHeaders;
const accounts = [];
let webBrowser, androidBrowser;
const check = async (response) => {
  if (!response.ok()) throw new Error(`Test API returned ${response.status()}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.text();
  return body ? JSON.parse(body) : null;
};
const backend = (method, path, data) => api.fetch(`${apiBase}${path}`, { method, headers: adminHeaders, data }).then(check);
const login = async (page, user) => {
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('请输入账号名或姓名').fill(user.username);
  await page.locator('input[type=password]').fill(user.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/app(?:\/|$)/, { timeout: 30_000, waitUntil: 'domcontentloaded' });
};
const screenshot = (name) => {
  adb('shell', 'screencap', '-p', `/sdcard/storehub-${name}.png`);
  adb('pull', `/sdcard/storehub-${name}.png`, `${directory}/${name}.png`);
};
const nativeUi = async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const output = adb('shell', 'uiautomator', 'dump', '/sdcard/storehub-ui.xml');
    if (output.includes('dumped')) return adb('shell', 'cat', '/sdcard/storehub-ui.xml');
  }
  throw new Error('Android accessibility hierarchy is not ready');
};
const tapText = (xml, text) => {
  const nodes = xml.match(/<node\b[^>]+>/g) || [];
  const node = nodes.find(value => value.includes(`text="${text}"`) || value.includes(`content-desc="${text}"`));
  assert(node, `Native UI lacks ${text}`);
  const [, left, top, right, bottom] = node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
  adb('shell', 'input', 'tap', `${(Number(left) + Number(right)) / 2}`, `${(Number(top) + Number(bottom)) / 2}`);
};

try {
  assert(adb('devices').includes('\tdevice'), 'Start an Android emulator first');
  // A headless emulator may need the host's existing network proxy. No proxy is baked into the APK.
  if (proxy) {
    const hostProxy = new URL(proxy.server);
    if (hostProxy.hostname === '127.0.0.1' || hostProxy.hostname === 'localhost') adb('shell', 'settings', 'put', 'global', 'http_proxy', `10.0.2.2:${hostProxy.port}`);
  }
  adb('install', '-r', 'android/app/build/outputs/apk/development/debug/app-development-debug.apk');
  adb('shell', 'am', 'force-stop', 'com.storehub.app.development');
  adb('shell', 'am', 'start', '-W', '-f', '0x10008000', '-n', 'com.storehub.app.development/com.storehub.app.MainActivity');
  let pid;
  for (let attempt = 0; attempt < 10 && !pid; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try { pid = adb('shell', 'pidof', 'com.storehub.app.development'); } catch { /* Android activity launch is asynchronous. */ }
  }
  assert(pid, 'Android app process did not start');
  adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  // Android WebView does not expose browser context/download management.
  androidBrowser = await chromium.connectOverCDP('http://127.0.0.1:9223', { noDefaults: true });
  const app = androidBrowser.contexts()[0].pages()[0];
  app.setDefaultTimeout(30_000);
  await app.getByPlaceholder('请输入账号名或姓名').waitFor();
  assert.equal(new URL(app.url()).origin, base);
  assert.equal(await app.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false);
  screenshot('login');
  report('Android emulator renders shared login without horizontal overflow');
  await app.waitForFunction(() => window.__storehubAndroidDownloads === true);

  // Check actual Android document save and byte integrity, including immediate URL revocation.
  const exportName = `StoreHub-android-check-${Date.now()}.txt`;
  await app.evaluate(name => {
    const url = URL.createObjectURL(new Blob(['StoreHub Android export verified'], { type: 'text/plain' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
  }, exportName);
  const saveUi = await nativeUi();
  assert(saveUi.includes('DocumentsUI') || saveUi.includes('documentsui'), 'Android save picker was not shown');
  screenshot('save-file');
  const saveNode = (saveUi.match(/<node\b[^>]+>/g) || []).find(node => node.includes('resource-id="com.google.android.documentsui:id/button1"') || /text="(SAVE|Save|保存)"/.test(node));
  assert(saveNode, 'Save button was not found');
  const saveBounds = saveNode.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/).slice(1).map(Number);
  adb('shell', 'input', 'tap', `${(saveBounds[0] + saveBounds[2]) / 2}`, `${(saveBounds[1] + saveBounds[3]) / 2}`);
  await app.waitForTimeout(700);
  assert.equal(adb('shell', 'cat', `/sdcard/Download/${exportName}`), 'StoreHub Android export verified');
  adb('shell', 'rm', `/sdcard/Download/${exportName}`);
  report('Blob export opens Android save picker and preserves file bytes');

  await app.evaluate(() => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.id = 'android-test-file'; document.body.append(input); input.click();
  });
  const uploadUi = await nativeUi();
  assert(/选择上传文件|Files|文件|Camera|相机|拍照|Photos|照片|Choose an action/.test(uploadUi), 'Native upload chooser was not displayed');
  screenshot('upload-chooser');
  adb('shell', 'input', 'keyevent', '4');
  await app.evaluate(() => document.getElementById('android-test-file')?.remove());
  report('Image upload opens native file/camera chooser and cancellation returns to page');

  await app.evaluate(() => { const image = new Image(); image.src = '/android-check-missing-image.png'; document.body.append(image); });
  await app.waitForTimeout(500);
  assert(await app.getByPlaceholder('请输入账号名或姓名').isVisible(), 'Image failure hid login page');
  assert((await nativeUi()).includes('android.webkit.WebView'), 'Image failure replaced the native WebView');
  report('Failed image request keeps available page content visible');

  const cliCandidates = globSync('C:/Users/hwson/AppData/Local/pnpm/store/v11/links/@supabase/cli-windows-x64/*/**/supabase.exe');
  const cli = process.env.SUPABASE_CLI_PATH || cliCandidates.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  assert(cli, 'Provide SUPABASE_CLI_PATH for authenticated test-database checks');
  // Capture keys in memory only; never log or write them to an artifact.
  const keys = JSON.parse(execFileSync(cli, ['projects', 'api-keys', '--project-ref', project, '--output-format', 'json', '--agent', 'no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 }));
  const serviceKey = keys.keys.find(key => key.id === 'service_role')?.api_key;
  assert(serviceKey, 'Test project administrative connection is unavailable');
  adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  const profiles = await backend('GET', '/rest/v1/profiles?select=role&is_active=eq.true');
  assert(profiles.length > 0, 'Test database has no active accounts');
  const stores = await backend('GET', '/rest/v1/stores?select=id,name&is_active=eq.true');
  const store = stores.find(value => value.name.includes('西直门'));
  assert(store, 'Test database needs the existing 西直门 store');
  report('Existing test database accounts and store verified without reading/resetting passwords');
  // Temporary accounts exercise the real password login endpoint and all three roles.
  for (const role of ['staff', 'manager', 'admin']) {
    const username = `android-qa-${role}-${Date.now()}`;
    const password = `Qa-${randomUUID()}-Aa9`;
    const user = await backend('POST', '/auth/v1/admin/users', { email: `${username}@accounts.invalid`, password, email_confirm: true });
    accounts.push({ id: user.id, username, password, role });
    await backend('POST', '/rest/v1/profiles', { id: user.id, store_id: store.id, username, display_name: `安卓验证-${role}`, role, employment_type: 'full_time', is_active: true });
    await backend('POST', '/rest/v1/profile_store_access', { profile_id: user.id, store_id: store.id });
  }
  webBrowser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, proxy });
  for (const user of accounts) {
    await app.evaluate(() => localStorage.clear());
    await login(app, user);
    const web = await webBrowser.newPage({ viewport: { width: 390, height: 844 } });
    await login(web, user);
    await app.goto(`${base}/app/workbench`, { waitUntil: 'domcontentloaded' });
    await web.goto(`${base}/app/workbench`, { waitUntil: 'domcontentloaded' });
    await app.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    await web.getByRole('heading', { name: '工作台', exact: true }).waitFor();
    const links = page => page.locator('main a').evaluateAll(elements => elements.map(element => [element.textContent.trim(), element.getAttribute('href')]).sort());
    const appLinks = await links(app);
    assert(appLinks.length >= 5, 'Workbench links were not loaded');
    assert.deepEqual(appLinks, await links(web), `${user.role} workbench routes differ`);
    screenshot(`workbench-${user.role}`);
    report(`Real ${user.role} password login and identical web/Android workbench links`);
    const paths = user.role === 'admin'
      ? ['/app/admin/products', '/app/admin/arrivals', '/app/admin/tasks', '/app/admin/announcements', '/app/admin/sops', '/app/admin/attendance', '/app/admin/payroll', '/app/admin/tax-accounting', '/app/admin/product-registrations', '/app/account/about']
      : ['/app/tasks', '/app/arrivals/history', '/app/history', '/app/notices', '/app/sops', '/app/attendance', '/app/payroll', '/app/overtime', '/app/product-registrations', '/app/account/about'];
    for (const path of paths) {
      await app.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
      await web.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
      await app.locator('h1').waitFor(); await web.locator('h1').waitFor();
      assert.equal(await app.locator('h1').innerText(), await web.locator('h1').innerText(), `${roleLabel(user)} ${path}`);
      assert.equal(await app.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1), false, `Overflow at ${path}`);
    }
    report(`${user.role}: ${paths.length} authenticated page titles match web and fit Android`);
    if (user.role === 'staff') {
      await app.goto(`${base}/app/product-registrations?type=other`);
      await app.getByRole('button', { name: '增加货品登记条目' }).click();
      const name = `Android同步验证-${Date.now()}`;
      await app.getByLabel('货品名称', { exact: true }).fill(name);
      await app.getByLabel('数量', { exact: true }).fill('2');
      await app.getByLabel('单位', { exact: true }).fill('个');
      await app.getByText('已自动保存', { exact: true }).waitFor();
      await web.goto(`${base}/app/product-registrations?type=other`);
      await web.getByLabel('货品名称', { exact: true }).waitFor();
      assert.equal(await web.getByLabel('货品名称', { exact: true }).inputValue(), name);
      await web.getByLabel('货品名称', { exact: true }).fill(`${name}-网页版修改`);
      await web.getByText('已自动保存', { exact: true }).waitFor();
      await app.reload();
      await app.getByLabel('货品名称', { exact: true }).waitFor();
      assert.equal(await app.getByLabel('货品名称', { exact: true }).inputValue(), `${name}-网页版修改`);
      screenshot('two-way-sync');
      report('Android UI save is visible in web UI; web UI edit is visible in Android after refresh');
    }
    await web.close();
  }
  await app.evaluate(() => localStorage.clear());
  await app.goto(`${base}/login`);
  // Main-document failure is the only condition that should replace the web page.
  const session = await app.context().newCDPSession(app);
  await session.send('Network.enable');
  await session.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await app.reload({ timeout: 5000 }).catch(() => {});
  const errorUi = await nativeUi();
  assert(errorUi.includes('重新加载'), 'No native retry state after document network failure');
  screenshot('offline-retry');
  await session.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  tapText(errorUi, '重新加载');
  await app.getByPlaceholder('请输入账号名或姓名').waitFor();
  report('Offline document error shows retry and reconnect restores shared login');
  await session.detach();
  await androidBrowser.close(); androidBrowser = undefined;
  adb('shell', 'am', 'force-stop', 'com.storehub.app.development');
  adb('shell', 'am', 'start', '-W', '-f', '0x10008000', '-n', 'com.storehub.app.development/com.storehub.app.MainActivity');
  await new Promise(resolve => setTimeout(resolve, 2000));
  adb('shell', 'input', 'keyevent', '4');
  assert((await nativeUi()).includes('退出 StoreHub'), 'Android back did not show exit confirmation');
  adb('shell', 'input', 'keyevent', '4');
  report('Android system back uses native exit confirmation at root');
  writeFileSync(`${directory}/report.json`, JSON.stringify({ checkedAt: new Date().toISOString(), emulator: adb('shell', 'getprop', 'ro.build.version.release'), site: base, checks: results }, null, 2));
} finally {
  if (adminHeaders) for (const user of accounts) {
    // Delete only rows owned by the freshly created test accounts.
    await backend('DELETE', `/rest/v1/product_registration_entries?created_by=eq.${user.id}`).catch(error => console.error(`Cleanup registration failed: ${error.message}`));
    await backend('DELETE', `/rest/v1/tax_reporting_people?profile_id=eq.${user.id}`).catch(error => console.error(`Cleanup generated tax profile failed: ${error.message}`));
    await backend('DELETE', `/auth/v1/admin/users/${user.id}`).catch(error => console.error(`Cleanup account failed: ${error.message}`));
  }
  await webBrowser?.close(); await androidBrowser?.close(); await api.dispose();
}
function roleLabel(user) { return user.role; }
