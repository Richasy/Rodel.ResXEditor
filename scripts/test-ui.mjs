import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const css = await readFile('media/editor.css', 'utf8');
const js = await readFile('media/editor.js', 'utf8');
const font = (await readFile('dist/codicon.ttf')).toString('base64');
const codicons = (await readFile('dist/codicon.css', 'utf8')).replace(/url\("\.\/codicon.ttf[^\"]*"\)/, `url("data:font/ttf;base64,${font}")`);
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const entries = [{ key: 'Welcome', value: '欢迎，{name}！', comment: '首页欢迎语', readonly: false }, { key: 'Count', value: '共 {0:N0} 条新闻', comment: '', readonly: false }, { key: 'Multiline', value: '第一行\n第二行', comment: '', readonly: false }, { key: 'Logo', value: 'AA==', comment: '', readonly: true, reason: 'Unsupported resource type: Bitmap' }];
const fixture = [{ uri: 'file:///zh.resw', version: 1, dirty: false, error: '', language: 'zh-CN', entries }, { uri: 'file:///en.resw', version: 1, dirty: false, error: '', language: 'en-US', entries: [{ key: 'Welcome', value: 'Welcome, {name}!', comment: '', readonly: false }, { key: 'Multiline', value: '第一行\n第二行', comment: '', readonly: false }] }];
async function state(items = fixture) { await page.evaluate(items => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', items, source: 'zh-CN', showComments: true } })), items); }
async function ack() { await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'ack' } }))); }
await page.setContent('<html><body><main id="app"></main></body></html>');
await page.addStyleTag({ content: css + '\n' + codicons });
await page.addScriptTag({ content: 'window.sent = []; window.acquireVsCodeApi = () => ({ getState: () => ({}), setState: () => {}, postMessage: message => window.sent.push(message) });' });
await page.addScriptTag({ content: js });
await state(); await ack();
assert.equal(await page.locator('tbody tr').count(), 4);
assert.equal(await page.locator('td.missing').count(), 1);
assert.equal(await page.locator('td.same').count(), 1);
const originalRowHeights = await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
const hiddenStatusStyle = await page.addStyleTag({ content: '.cell-indicator, .cell-tooltip { display: none !important; }' });
assert.deepEqual(await page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height)), originalRowHeights, 'status indicators never contribute to row height');
await hiddenStatusStyle.evaluate(el => el.remove());
assert.equal(originalRowHeights[0], originalRowHeights[3], 'missing and normal single-line rows have equal height');
assert.ok(originalRowHeights[2] > originalRowHeights[0], 'multiline text alone grows the row');
const missingIndicator = page.getByRole('img', { name: 'Missing translation', exact: true });
await missingIndicator.hover();
await page.getByRole('tooltip').filter({ hasText: 'Missing translation.' }).waitFor({ state: 'visible' });
await page.mouse.move(0, 0);
const missingInput = page.getByRole('textbox', { name: 'Count, en-US, value, missing', exact: true });
await missingInput.focus(); await missingInput.press('Alt+ArrowRight');
assert.equal(await missingIndicator.evaluate(el => el === document.activeElement), true);
await missingIndicator.press('Escape');
assert.equal(await missingInput.evaluate(el => el === document.activeElement), true);
const count = page.getByRole('textbox', { name: 'Count, en-US, value, missing', exact: true });
await count.fill('Total {0:N0}'); await count.press('Tab');
assert.equal((await page.evaluate(() => window.sent.at(-1))).action, 'set');
assert.equal((await page.evaluate(() => window.sent.at(-1))).expectedValue, '');
assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Count, zh-CN, comment');
await ack();
await page.getByRole('searchbox').fill('Welcome'); assert.equal(await page.locator('tbody tr').count(), 1);
await page.getByRole('searchbox').fill('');
await page.getByLabel('Filter resources').selectOption('missing'); assert.equal(await page.locator('tbody tr').count(), 1);
await page.getByLabel('Filter resources').selectOption('all');
const draft = page.getByRole('textbox', { name: 'Welcome, zh-CN, value', exact: true });
await draft.focus(); await draft.fill('unsent draft {name}'); await state(); assert.equal(await draft.inputValue(), 'unsent draft {name}', 'external state preserves focused draft');
await draft.press('Escape');
assert.equal(await page.locator('tr').filter({ hasText: 'Logo' }).locator('textarea:not([readonly])').count(), 0);
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview', rows: [{ id: '0:0', key: 'Welcome', language: 'en-US', field: 'value', before: 'Welcome', after: 'Hello' }, { id: '0:1', key: 'Count', language: 'en-US', field: 'value', before: '', after: 'Total' }] } })));
await page.getByLabel('Apply Welcome, en-US, value').uncheck();
await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
assert.deepEqual((await page.evaluate(() => window.sent.at(-1))).selection, ['0:1']); await ack();
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewClosed' } })));
await page.getByRole('button', { name: 'More actions', exact: true }).click();
await page.getByRole('menuitem', { name: 'Bulk add', exact: true }).click();
await page.getByLabel('Resource keys, one per line').fill('First\nSecond');
await page.getByRole('button', { name: 'Add keys', exact: true }).click();
assert.deepEqual((await page.evaluate(() => window.sent.at(-1))).keys, ['First', 'Second']); await ack();
await page.getByRole('button', { name: 'More actions', exact: true }).click();
await page.getByRole('menuitem', { name: 'Bulk add', exact: true }).press('Escape');
assert.equal(await page.getByRole('menu').isVisible(), false, 'Escape closes actions and restores focus');
await page.getByLabel('Select Welcome', { exact: true }).check();
assert.equal(await page.locator('.selectionbar').isVisible(), true);
await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
assert.equal(await page.locator('.selectionbar').isVisible(), false);
await page.getByRole('button', { name: 'Toggle language sidebar', exact: true }).click();
assert.equal(await page.getByRole('complementary').isVisible(), false);
await page.getByRole('button', { name: 'Toggle language sidebar', exact: true }).click();
// Use a realistic independent resource sample for the design previews.
const demo = [
    ['Loading', '正在加载新闻…', 'Loading news…', '列表加载状态'],
    ['News.Empty', '暂时没有新内容', '', '新闻列表为空时的提示'],
    ['Reading.Save', '稍后阅读', 'Read later', '文章操作按钮'],
    ['Search.Placeholder', '搜索新闻、话题与作者', 'Search news, topics and authors', '搜索框占位文字'],
    ['Settings.Language', '界面语言', 'Display language', '设置页语言选项']
];
await state(fixture.map((item, index) => ({ ...item, entries: [...item.entries, ...demo.map(([key, value, target, comment]) => ({ key, value: index === 0 ? value : target, comment: index === 0 ? comment : '', readonly: false }))] })));
await page.getByRole('searchbox').blur();
await page.setViewportSize({ width: 1440, height: 760 });
const themes = {
    dark: { background: '#1f1f1f', foreground: '#cccccc', panel: '#333333', input: '#313131', sidebar: '#181818', focus: '#007fd4', button: '#0078d4', selection: '#37373d' },
    light: { background: '#ffffff', foreground: '#3b3b3b', panel: '#e5e5e5', input: '#ffffff', sidebar: '#f8f8f8', focus: '#0090f1', button: '#005fb8', selection: '#e4e6f1' },
    highContrast: { background: '#000000', foreground: '#ffffff', panel: '#6fc3df', input: '#000000', sidebar: '#000000', focus: '#f38518', button: '#0f4a85', selection: '#0f4a85' },
    custom: { background: '#191724', foreground: '#e0def4', panel: '#524f67', input: '#26233a', sidebar: '#1f1d2e', focus: '#c4a7e7', button: '#31748f', selection: '#403d52' }
};
for (const [name, theme] of Object.entries(themes)) {
    await page.evaluate(t => {
        const vars = { 'editor-background': t.background, 'editor-foreground': t.foreground, 'panel-border': t.panel, 'input-background': t.input, 'input-foreground': t.foreground, 'sideBar-background': t.sidebar, 'sideBar-foreground': t.foreground, 'focusBorder': t.focus, 'button-background': t.button, 'button-foreground': '#ffffff', 'list-inactiveSelectionBackground': t.selection, 'descriptionForeground': t.foreground, 'editorWarning-foreground': '#cca700', 'editorInfo-foreground': '#3794ff', 'dropdown-background': t.input, 'dropdown-foreground': t.foreground, 'dropdown-border': t.panel, 'progressBar-background': t.focus, 'font-family': 'Segoe UI', 'font-size': '13px', 'editor-font-family': 'Cascadia Code, Consolas, monospace', 'editor-font-size': '14px' };
        for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--vscode-${key}`, value);
    }, theme);
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
    assert.equal(await page.locator('table').first().evaluate(el => getComputedStyle(el).color), await page.locator('body').evaluate(el => getComputedStyle(el).color), 'table follows foreground changes in every theme');
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), `rgb(${parseInt(theme.background.slice(1,3),16)}, ${parseInt(theme.background.slice(3,5),16)}, ${parseInt(theme.background.slice(5,7),16)})`);
}
assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: grid CRUD message, Tab navigation, search/filter, draft preservation, read-only types, preview selection, bulk add and dark/light/high contrast/custom theme screenshots.');
