import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
await mkdir('.vscode-test', { recursive: true });
await build({ entryPoints: ['src/core/xml.ts'], outfile: '.vscode-test/ui-xml.cjs', bundle: true, platform: 'node', format: 'cjs' });
const { parseResource } = createRequire(import.meta.url)('../.vscode-test/ui-xml.cjs');
const css = await readFile('media/editor.css', 'utf8');
const js = await readFile('media/editor.js', 'utf8');
const font = (await readFile('dist/codicon.ttf')).toString('base64');
const codicons = (await readFile('dist/codicon.css', 'utf8')).replace(/url\("\.\/codicon.ttf[^\"]*"\)/, `url("data:font/ttf;base64,${font}")`);
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2.5 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
const entries = [{ key: 'Welcome', value: '欢迎，{name}！', comment: '首页欢迎语', readonly: false }, { key: 'Count', value: '共 {0:N0} 条新闻', comment: '', readonly: false }, { key: 'Multiline', value: '第一行\n第二行', comment: '', readonly: false }, { key: 'Logo', value: 'AA==', comment: '', readonly: true, reason: 'Unsupported resource type: Bitmap' }];
const fixture = [{ uri: 'file:///zh.resw', version: 1, dirty: false, error: '', language: 'zh-CN', entries }, { uri: 'file:///en.resw', version: 1, dirty: false, error: '', language: 'en-US', entries: [{ key: 'Welcome', value: 'Welcome, {name}!', comment: '', readonly: false }, { key: 'Multiline', value: '第一行\n第二行', comment: '', readonly: false }] }];
async function state(items = fixture, extra = {}) { await page.evaluate(({ items, extra }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', items, source: 'zh-CN', showComments: true, ...extra } })), { items, extra }); }
async function ack() { await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'ack' } }))); }
await page.setContent('<html><body><main id="app"></main></body></html>');
await page.addStyleTag({ content: css + '\n' + codicons });
await page.addScriptTag({ content: 'window.sent = []; window.acquireVsCodeApi = () => ({ getState: () => window.savedState || {}, setState: state => { window.savedState = state; }, postMessage: message => window.sent.push(message) });' });
const validation = await build({ entryPoints: ['src/preview-validation.ts'], bundle: true, platform: 'browser', format: 'iife', write: false });
await page.addScriptTag({ content: validation.outputFiles[0].text });
await page.addScriptTag({ content: js });
await state(); await ack();
await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function checkCentered() {
    const offsets = await page.locator('tbody textarea').evaluateAll(inputs => inputs.filter(input => { const style = getComputedStyle(input); return input.clientHeight <= parseFloat(style.lineHeight) + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 1; }).map(input => {
        const style = getComputedStyle(input);
        const rect = input.getBoundingClientRect();
        const cell = input.closest('td').getBoundingClientRect();
        return { label: input.getAttribute('aria-label'), offset: Math.abs(rect.top + parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2 - (cell.top + (cell.height - 1) / 2)) };
    }));
    for (const { label, offset } of offsets) assert.ok(offset <= 1, `${label}: single-line text center differs by ${offset}px`);
}
await checkCentered();
const iconOffsets = await page.locator('button.icon-button').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect(); const icon = button.querySelector('.codicon').getBoundingClientRect();
    return { label: button.getAttribute('aria-label'), offset: Math.abs(icon.left + icon.width / 2 - rect.left - rect.width / 2) };
}));
for (const { label, offset } of iconOffsets) assert.ok(offset <= .5, `${label}: icon horizontally centered, offset ${offset}px`);
assert.equal(await page.locator('tbody textarea.is-scrollable').count(), 0, 'short, empty and readonly cells never enable scrollbars');
assert.ok(await page.locator('tbody textarea').evaluateAll(inputs => inputs.every(input => getComputedStyle(input).overflowY === 'hidden')));
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
// Select-only settings-style combobox supports native-feeling keyboard navigation.
const resourceCombo = page.getByRole('combobox', { name: 'Filter resources' });
await resourceCombo.focus(); await resourceCombo.press('ArrowDown');
assert.equal(await page.getByRole('listbox', { name: 'Filter resources' }).isVisible(), true);
await page.getByRole('option', { name: 'All resources Default', exact: true }).press('ArrowDown');
await page.getByRole('option', { name: 'Missing translations', exact: true }).press('Enter');
assert.equal(await page.locator('tbody tr').count(), 1);
await resourceCombo.press('ArrowDown');
await page.getByRole('option', { name: 'Missing translations', exact: true }).press('Home');
await page.getByRole('option', { name: 'All resources Default', exact: true }).press('Enter');
await resourceCombo.press('ArrowDown'); await page.getByRole('option', { name: 'All resources Default', exact: true }).press('Escape');
assert.equal(await resourceCombo.getAttribute('aria-expanded'), 'false');
assert.equal(await resourceCombo.evaluate(el => el === document.activeElement), true);
const visibleButton = () => page.getByRole('button', { name: /^Visible languages/ });
await visibleButton().click();
assert.equal(await page.getByRole('checkbox', { name: 'Show zh-CN', exact: true }).isDisabled(), true);
assert.equal(await page.getByRole('checkbox', { name: 'Show zh-CN', exact: true }).isChecked(), true);
await page.getByRole('checkbox', { name: 'Show en-US', exact: true }).uncheck();
assert.equal(await page.locator('thead th').count(), 3, 'hidden target removes only its column');
assert.equal(await page.locator('.language-status').count(), 2, 'completion includes hidden targets');
await page.getByRole('searchbox', { name: 'Search languages', exact: true }).fill('English');
assert.equal(await page.locator('.language-options input').count(), 1, 'language search matches display name');
await page.getByRole('checkbox', { name: 'Show en-US', exact: true }).check();
await page.getByRole('checkbox', { name: 'Show en-US', exact: true }).press('Escape');
assert.equal(await visibleButton().getAttribute('aria-expanded'), 'false');
await visibleButton().click(); await page.getByRole('button', { name: 'Source only', exact: true }).click();
await page.getByRole('searchbox', { name: 'Search languages', exact: true }).press('Escape');
await page.locator('.missing-link').filter({ hasText: 'Count' }).click();
assert.equal(await page.locator('thead th').count(), 4, 'missing link reveals hidden target');
assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Count, en-US, value, missing');
await state();
assert.equal(await page.locator('thead th').count(), 4, 'external refresh preserves language visibility');
await page.getByRole('searchbox').fill('Welcome'); assert.equal(await page.locator('tbody tr').count(), 1);
await page.getByRole('searchbox').fill('');
await page.getByRole('combobox', { name: 'Filter resources' }).click(); await page.getByRole('option', { name: 'Missing translations', exact: true }).click(); assert.equal(await page.locator('tbody tr').count(), 1);
await page.getByRole('combobox', { name: 'Filter resources' }).click(); await page.getByRole('option', { name: 'All resources Default', exact: true }).click();
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
await page.getByRole('button', { name: 'More actions', exact: true }).click();
const commentsMenu = page.getByRole('menuitemcheckbox', { name: 'Show comment column', exact: true });
assert.equal(await commentsMenu.getAttribute('aria-checked'), 'true');
assert.equal(await commentsMenu.locator('.codicon-comment').count(), 1);
assert.equal(await commentsMenu.locator('.codicon-check').count(), 0, 'toggle keeps its comment icon without a checkmark');
assert.equal(await page.getByRole('menuitem', { name: 'Export to Excel…', exact: true }).count(), 1);
assert.equal(await page.getByRole('menuitem', { name: 'Import from Excel…', exact: true }).count(), 1);
await commentsMenu.click(); assert.equal((await page.evaluate(() => window.sent.at(-1))).value, 'false'); await ack();
await state(fixture, { showComments: false }); assert.equal(await page.locator('th.comment-heading').count(), 0);
await page.getByRole('button', { name: 'More actions', exact: true }).click(); assert.equal(await commentsMenu.getAttribute('aria-checked'), 'false');
await commentsMenu.click(); await ack(); await state();
const addedKey = 'ZZZ.New.Resource';
const addedFixture = fixture.map(item => ({ ...item, entries: [...item.entries, { key: addedKey, value: '', comment: '', readonly: false }] }));
await page.getByRole('searchbox', { name: 'Search key, value or comment', exact: true }).fill('Welcome');
await state(addedFixture, { revealKeys: [addedKey] });
await page.waitForTimeout(50);
assert.equal(await page.getByRole('searchbox', { name: 'Search key, value or comment', exact: true }).inputValue(), '', 'successful add clears filters that would hide the new key');
assert.equal(await page.locator('tr.selected').getAttribute('data-key'), addedKey);
assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), `${addedKey}, zh-CN, value, missing`);
await state();
await page.getByRole('button', { name: 'Toggle language sidebar', exact: true }).click();
assert.equal(await page.getByRole('complementary').isVisible(), false);
await page.getByRole('button', { name: 'Toggle language sidebar', exact: true }).click();
// Streaming preview preserves selection and bypasses the busy action queue to cancel.
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview', running: true, rows: [{ id: 'stable:a', key: 'First', language: 'en-US', field: 'value', before: '', after: 'First translation' }] } })));
await page.getByRole('checkbox', { name: 'Apply First, en-US, value' }).uncheck();
assert.equal(await page.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(), true);
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview', running: true, rows: [{ id: 'stable:b', key: 'Second', language: 'fr', field: 'value', before: '', after: 'Second translation' }, { id: 'stable:a', key: 'First', language: 'en-US', field: 'value', before: '', after: 'First translation' }] } })));
assert.equal(await page.getByRole('checkbox', { name: 'Apply First, en-US, value' }).isChecked(), false);
assert.equal(await page.locator('.preview input[type=checkbox]').count(), 2);
await page.getByRole('button', { name: 'Cancel translation', exact: true }).click();
assert.equal(await page.evaluate(() => window.sent.some(m => m.action === 'cancelTranslation')), true);
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview', running: false, cancelled: true, rows: [{ id: 'stable:a', key: 'First', language: 'en-US', field: 'value', before: '', after: 'First translation' }, { id: 'stable:b', key: 'Second', language: 'fr', field: 'value', before: '', after: 'Second translation' }] } })));
assert.equal(await page.getByRole('button', { name: 'Apply changes', exact: true }).isEnabled(), true);
assert.equal(await page.getByRole('button', { name: 'Cancel translation', exact: true }).isVisible(), false);
assert.equal(await page.getByRole('checkbox', { name: 'Apply First, en-US, value' }).isChecked(), false);
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewClosed' } })));

// Review filters, editable drafts, shared token validation and genuine cancel-button visibility.
const reviewRows = [
    { id: 'editable:en', key: 'Greeting', language: 'en-US', field: 'value', before: '', after: 'Hello {name}\nWelcome' },
    { id: 'editable:fr', key: 'Greeting', language: 'fr', field: 'value', before: '', after: 'Bonjour {name}\nBienvenue' }
];
async function reviewMessage(running, rows = reviewRows) { await page.evaluate(({ running, rows }) => window.dispatchEvent(new MessageEvent('message', { data: { type: 'preview', translation: true, running, rows } })), { running, rows }); }
await reviewMessage(true);
const proposed = page.getByRole('textbox', { name: 'Proposed Greeting, en-US, value', exact: true });
await proposed.fill('Hi {name}\nGood day');
await reviewMessage(true, [...reviewRows, { id: 'editable:second', key: 'Save', language: 'en-US', field: 'value', before: '', after: 'Save' }]);
assert.equal(await proposed.inputValue(), 'Hi {name}\nGood day');
await page.getByRole('combobox', { name: 'Filter preview language' }).click();
await page.getByRole('option', { name: 'fr', exact: true }).click();
assert.equal(await page.locator('.preview tr:not([hidden]) textarea').count(), 1);
await page.getByRole('button', { name: 'Deselect visible', exact: true }).click();
assert.equal(await page.getByRole('checkbox', { name: 'Apply Greeting, fr, value' }).isChecked(), false);
await page.getByRole('combobox', { name: 'Filter preview language' }).click();
await page.getByRole('option', { name: 'All languages Default', exact: true }).click();
await page.getByRole('searchbox', { name: 'Search preview', exact: true }).fill('Good day');
assert.equal(await page.locator('.preview tr:not([hidden]) textarea').count(), 1);
await proposed.fill('Wrong placeholder');
assert.equal(await proposed.getAttribute('aria-invalid'), 'true');
await page.getByRole('searchbox', { name: 'Search preview', exact: true }).fill('');
await reviewMessage(false, [...reviewRows, { id: 'editable:second', key: 'Save', language: 'en-US', field: 'value', before: '', after: 'Save' }]);
assert.equal(await page.getByRole('button', { name: 'Cancel translation', exact: true }).isVisible(), false);
assert.equal(await page.getByRole('button', { name: 'Apply changes', exact: true }).isDisabled(), true);
await proposed.fill('Hi {name}\nGood day');
await page.keyboard.press('Control+f');
assert.equal(await page.getByRole('searchbox', { name: 'Search preview', exact: true }).evaluate(el => el === document.activeElement), true);
await page.getByRole('button', { name: 'Apply changes', exact: true }).click();
const editedMessage = await page.evaluate(() => window.sent.at(-1));
assert.deepEqual(editedMessage.selection, ['editable:en', 'editable:second']);
assert.equal(editedMessage.edits['editable:en'], 'Hi {name}\nGood day');
await ack();
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewClosed' } })));

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
async function applyTheme(theme) {
    await page.evaluate(t => {
        const vars = { 'editor-background': t.background, 'editor-foreground': t.foreground, 'panel-border': t.panel, 'input-background': t.input, 'input-foreground': t.foreground, 'sideBar-background': t.sidebar, 'sideBar-foreground': t.foreground, 'focusBorder': t.focus, 'button-background': t.button, 'button-foreground': '#ffffff', 'list-inactiveSelectionBackground': t.selection, 'descriptionForeground': t.foreground, 'editorWarning-foreground': '#cca700', 'editorInfo-foreground': '#3794ff', 'dropdown-background': t.input, 'dropdown-foreground': t.foreground, 'dropdown-border': t.panel, 'progressBar-background': t.focus, 'font-family': 'Segoe UI', 'font-size': '13px', 'editor-font-family': 'Cascadia Code, Consolas, monospace', 'editor-font-size': '14px' };
        for (const [key, value] of Object.entries(vars)) document.documentElement.style.setProperty(`--vscode-${key}`, value);
    }, theme);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
for (const [name, theme] of Object.entries(themes)) {
    await applyTheme(theme);
    await checkCentered();
    await page.screenshot({ path: `test-results/${name}.png`, fullPage: true });
    assert.equal(await page.locator('table').first().evaluate(el => getComputedStyle(el).color), await page.locator('body').evaluate(el => getComputedStyle(el).color), 'table follows foreground changes in every theme');
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), `rgb(${parseInt(theme.background.slice(1,3),16)}, ${parseInt(theme.background.slice(3,5),16)}, ${parseInt(theme.background.slice(5,7),16)})`);
}
const longFixture = await Promise.all(['zh-CN', 'en-US'].map(async language => ({ uri: `file:///LongText/Strings/${language}/Resources.resw`, language, version: 1, dirty: false, error: '', entries: parseResource(await readFile(`samples/LongText/Strings/${language}/Resources.resw`, 'utf8')).entries.map(({ key, value, comment, readonly, reason }) => ({ key, value, comment, readonly, reason })) })));
for (const zoom of [1.25, 1.5, 1.75]) {
    await page.evaluate(zoom => { document.body.style.zoom = String(zoom); document.documentElement.style.setProperty('--vscode-editor-font-size', '17.25px'); }, zoom);
    await page.waitForTimeout(100);
    assert.equal(await page.locator('tbody textarea.is-scrollable').count(), 0, `short cells stay scrollbar-free at ${zoom * 100}% zoom and fractional font size`);
}
await page.evaluate(() => { document.body.style.zoom = '1'; document.documentElement.style.setProperty('--vscode-editor-font-size', '14px'); });
await state(longFixture);
for (const [name, theme] of Object.entries(themes)) {
    await applyTheme(theme);
    await checkCentered();
    const measurements = await page.locator('tbody textarea').evaluateAll(inputs => inputs.map(input => ({ label: input.getAttribute('aria-label'), height: input.clientHeight, scroll: input.scrollHeight, width: input.clientWidth, limit: Math.ceil(parseFloat(getComputedStyle(input).lineHeight) * 12 + 20) })));
    for (const input of measurements) assert.ok(input.height <= input.limit, `${input.label}: bounded long-text height`);
    const paragraph = measurements.find(input => input.label === 'Long.Paragraph, en-US, value');
    assert.ok(paragraph.height > 65 && paragraph.scroll <= paragraph.height + 1, 'soft-wrapped paragraph grows to fit');
    const extreme = measurements.find(input => input.label === 'Stress.Extreme, zh-CN, value');
    assert.ok(extreme.scroll > extreme.height * 2, 'extreme text retains scrollable content');
    assert.ok(await page.locator('tbody textarea').evaluateAll(inputs => inputs.every(input => {
        if (input.classList.contains('is-scrollable')) return getComputedStyle(input).overflowY === 'auto' && input.scrollHeight > input.clientHeight;
        return getComputedStyle(input).overflowY === 'hidden' && input.scrollHeight <= input.clientHeight + 1;
    })), 'only genuinely capped long text enables scrolling');
    await page.locator('.grid-scroll').evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `test-results/long-text-${name}.png` });
}
const paragraphInput = page.getByRole('textbox', { name: 'Long.Paragraph, en-US, value', exact: true });
const normalFontHeight = await paragraphInput.evaluate(el => el.clientHeight);
await page.evaluate(() => document.documentElement.style.setProperty('--vscode-editor-font-size', '18px'));
await page.waitForTimeout(100);
assert.ok(await paragraphInput.evaluate(el => el.clientHeight) > normalFontHeight, 'editor font change remeasures text without a width change');
await checkCentered();
await page.evaluate(() => document.documentElement.style.setProperty('--vscode-editor-font-size', '14px'));
await page.waitForTimeout(100);
const wideHeight = await paragraphInput.evaluate(el => el.clientHeight);
await page.setViewportSize({ width: 950, height: 760 });
await page.waitForTimeout(100);
assert.ok(await paragraphInput.evaluate(el => el.clientHeight) >= wideHeight, 'narrow window remeasures wraps');
assert.ok(await page.locator('table').evaluate(el => el.getBoundingClientRect().width) < 1300, 'unbroken value and key do not force enormous columns');
const extremeInput = page.getByRole('textbox', { name: 'Stress.Extreme, zh-CN, value', exact: true });
const originalExtreme = await extremeInput.inputValue();
await extremeInput.focus(); await extremeInput.press('Control+End');
assert.ok(await extremeInput.evaluate(el => el.scrollTop) > 0, 'keyboard can reach final line');
const lastLineScroll = await extremeInput.evaluate(el => el.scrollTop);
await state(longFixture);
assert.equal(await extremeInput.evaluate(el => el.scrollTop), lastLineScroll, 'state update preserves scroll position inside long value');
await extremeInput.fill('短文本');
assert.ok(await extremeInput.evaluate(el => el.clientHeight) < 50, 'editing a long value to short text shrinks its editor');
assert.equal(await extremeInput.evaluate(el => getComputedStyle(el).overflowY), 'hidden', 'shrinking text removes its scrollbar');
await state(longFixture);
assert.equal(await extremeInput.inputValue(), '短文本', 'state update keeps edited long-text draft');
await extremeInput.press('Escape');
assert.equal(await extremeInput.inputValue(), originalExtreme, 'Escape restores all thirty lines');
await paragraphInput.fill('Edited paragraph\n' + originalExtreme);
await paragraphInput.press('Tab');
assert.equal((await page.evaluate(() => window.sent.at(-1))).value, 'Edited paragraph\n' + originalExtreme, 'long edit sends complete text without truncation');
await ack();
assert.deepEqual(errors, []);
// Many-language table: bounded columns, persistent selection, source switching,
// all-language translation scope, and a searchable popup with scrolling.
const cultures = ['de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'sv', 'tr', 'uk', 'zh-Hant'];
const manyRows = fixture.map(item => ({ ...item, entries: [...item.entries, ...Array.from({ length: 100 }, (_, i) => ({ key: `Row.${String(i).padStart(3, '0')}`, value: 'Text', comment: '', readonly: false })), { key: 'ZZZ.Added.Last', value: '', comment: '', readonly: false }] }));
await state(manyRows, { revealKeys: ['ZZZ.Added.Last'] }); await page.waitForTimeout(50);
assert.ok(await page.locator('.grid-scroll').evaluate(el => el.scrollTop) > 1000, 'added last row scrolls into view');
assert.equal(await page.locator('tr.selected').getAttribute('data-key'), 'ZZZ.Added.Last');
await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
const manyFixture = [...fixture, ...cultures.map(language => ({ ...fixture[1], uri: `file:///${language}.resw`, language, entries: [] }))];
await state(manyFixture);
assert.equal(await page.locator('thead th').count(), 4, '16 discovered languages do not add unselected columns');
assert.equal(await page.locator('.language-status').count(), 16);
await visibleButton().click(); await page.getByRole('searchbox', { name: 'Search languages', exact: true }).fill('ja');
await page.getByRole('checkbox', { name: 'Show ja', exact: true }).check();
await page.getByRole('searchbox', { name: 'Search languages', exact: true }).press('Escape');
assert.equal(await page.locator('thead th').count(), 5);
await state(manyFixture); assert.equal(await page.locator('thead th').count(), 5);
const reloadPage = await browser.newPage({ viewport: { width: 1440, height: 760 } });
reloadPage.on('pageerror', error => errors.push(String(error)));
await reloadPage.setContent('<html><body><main id="app"></main></body></html>');
await reloadPage.addStyleTag({ content: css + '\n' + codicons });
await reloadPage.evaluate(saved => { window.savedState = saved; window.acquireVsCodeApi = () => ({ getState: () => window.savedState, setState: state => { window.savedState = state; }, postMessage: () => {} }); }, await page.evaluate(() => window.savedState));
await reloadPage.addScriptTag({ content: js });
await reloadPage.evaluate(items => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', items, source: 'zh-CN', showComments: true } })), manyFixture);
assert.equal(await reloadPage.locator('thead th').count(), 5, 'reopened editor restores language selection');
await reloadPage.close();
await page.getByRole('combobox', { name: 'Source language' }).click();
await page.getByRole('option', { name: 'ja', exact: true }).click();
assert.equal((await page.evaluate(() => window.sent.at(-1))).source, 'ja'); await ack();
await page.evaluate(items => window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', items, source: 'ja', showComments: true } })), manyFixture);
await visibleButton().click(); assert.equal(await page.getByRole('checkbox', { name: 'Show ja', exact: true }).isDisabled(), true);
assert.equal(await page.getByRole('checkbox', { name: 'Show zh-CN', exact: true }).isDisabled(), false);
await page.getByRole('button', { name: 'Source only', exact: true }).click();
await page.getByRole('searchbox', { name: 'Search languages', exact: true }).press('Escape');
assert.equal(await page.locator('thead th').count(), 3);
await page.getByRole('button', { name: 'Translate', exact: true }).click();
assert.deepEqual((await page.evaluate(() => window.sent.at(-1))).keys, [], 'language display filter never narrows translation action scope'); await ack();
await visibleButton().click(); await page.getByRole('button', { name: 'Show all', exact: true }).click();
await page.getByRole('searchbox', { name: 'Search languages', exact: true }).press('Escape');
assert.equal(await page.locator('thead th').count(), 18);
assert.ok(await page.locator('table').evaluate(el => el.getBoundingClientRect().width) > 3500, 'all-language view scrolls with readable minimum column widths');
await visibleButton().click(); await page.getByRole('button', { name: 'Source only', exact: true }).click();
await page.getByRole('checkbox', { name: 'Show zh-CN', exact: true }).check();
await page.getByRole('checkbox', { name: 'Show en-US', exact: true }).check();
await page.getByRole('searchbox', { name: 'Search languages', exact: true }).press('Escape');
await state(manyFixture);
await page.setViewportSize({ width: 1440, height: 760 });
for (const [name, theme] of Object.entries(themes)) {
    await applyTheme(theme);
    await visibleButton().click();
    await page.screenshot({ path: `test-results/language-picker-${name}.png` });
    await page.getByRole('searchbox', { name: 'Search languages', exact: true }).press('Escape');
    await resourceCombo.click();
    await page.screenshot({ path: `test-results/settings-combo-${name}.png` });
    await page.getByRole('option', { name: 'All resources Default', exact: true }).press('Escape');
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    assert.notEqual(await commentsMenu.evaluate(el => getComputedStyle(el).backgroundColor), await page.getByRole('menuitem', { name: 'Export to Excel…', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor), 'active comment toggle is visibly highlighted');
    await page.screenshot({ path: `test-results/more-actions-${name}.png` });
    await page.getByRole('menuitem', { name: 'Bulk add', exact: true }).press('Escape');
}
const visualReviewRows = [...reviewRows.map(row => ({ ...row, sourceValue: '你好，{name}！\n欢迎回来', sourceComment: '主页欢迎语，语气友好、简洁' })), { id: 'preview:long', key: 'Article.Empty', language: 'en-US', field: 'value', sourceValue: '这里还没有文章。尝试刷新列表，或者切换分类查看其他内容。', sourceComment: '列表为空时的说明', before: '', after: 'There are no articles here yet. Refresh the list, or choose another category to explore more content.' }];
await reviewMessage(false, visualReviewRows);
for (const [name, theme] of Object.entries(themes)) {
    await applyTheme(theme);
    assert.equal(await page.getByRole('button', { name: 'Cancel translation', exact: true }).isVisible(), false);
    await page.screenshot({ path: 'test-results/editable-preview-' + name + '.png' });
}
await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'previewClosed' } })));
assert.deepEqual(errors, []);
await browser.close();
console.log('PASS: centered text, long paragraphs/newlines/keys/URLs/comments, resize, height cap and full edits; grid CRUD message, Tab navigation, search/filter, draft preservation, read-only types, preview selection, bulk add and dark/light/high contrast/custom theme screenshots.');
