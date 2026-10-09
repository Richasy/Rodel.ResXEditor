import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import type { LanguageDocument } from '../src/documents';
import { newResource, applyOperations } from '../src/core/xml';

const compiling = build({ entryPoints: ['src/copilot.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false });
const nodeRequire = createRequire(__filename);
class ModelError extends Error { code = 'NoPermissions'; }
async function harness(options: { unavailable?: boolean; fail?: boolean; cancel?: boolean; changed?: 'source' | 'target'; sourceCount?: number; targetLanguages?: string[] } = {}) {
    const compiled = await compiling;
    const sourceText = applyOperations(newResource(), Array.from({ length: options.sourceCount ?? 45 }, (_, i) => ({ kind: 'add' as const, key: `Key.${i}`, value: `你好 {name} ${i}`, comment: `Home greeting ${i}` })));
    const targetText = applyOperations(newResource(), [{ kind: 'add', key: 'Key.0', value: 'Human translation {name}' }]);
    const makeDoc = (language: string, text: string) => ({ language, document: { version: 1, text, uri: { toString: () => `file:///${language}/Resources.resw` }, getText() { return this.text; } } });
    const source = makeDoc('zh-CN', sourceText); const target = makeDoc('en-US', targetText);
    const targets = (options.targetLanguages ?? ['en-US']).map(language => language === 'en-US' ? target : makeDoc(language, newResource()));
    const requests: string[] = []; const info: string[] = []; let selections = 0; let picks = 0; let cancelled = false;
    const token = { get isCancellationRequested() { return cancelled; } };
    const model = { name: 'Test model', id: 'test', family: 'test', maxInputTokens: 32000,
        countTokens: async () => 100,
        sendRequest: async (messages: string[]) => {
            requests.push(messages[0]);
            if (options.cancel) { cancelled = true; throw new Error('Request aborted by user'); }
            if (options.fail) throw new ModelError('Authorization declined');
            if (options.changed) (options.changed === 'source' ? source : target).document.version++;
            const prompt = messages[0]; const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
            return { text: (async function* () { const result = JSON.stringify({ translations: data.resources.map((r: { id: string; key: string }) => ({ id: r.id, value: `Hello {name} ${r.key}` })) }); yield result.slice(0, 20); yield result.slice(20); })() };
        }
    };
    const mock = {
        LanguageModelError: ModelError, LanguageModelChatMessage: { User: (text: string) => text }, ProgressLocation: { Notification: 1 },
        lm: { selectChatModels: async (selector: { vendor: string }) => { selections++; assert.equal(selector.vendor, 'copilot'); return options.unavailable ? [] : [model]; } },
        workspace: { getConfiguration: () => ({ get: (key: string, fallback: unknown) => key === 'translationLimit' ? 100 : fallback }) },
        window: { showQuickPick: async (items: unknown[], settings: { canPickMany?: boolean }) => { picks++; return settings.canPickMany ? items : items[0]; },
            showInformationMessage: (message: string) => info.push(message), showWarningMessage: (message: string) => info.push(message),
            withProgress: async (_settings: unknown, work: (progress: { report: () => void }, token: unknown) => Promise<unknown>) => work({ report: () => {} }, token) }
    };
    const module = { exports: {} as typeof import('../src/copilot') };
    new Function('require', 'module', 'exports', compiled.outputFiles[0].text)((name: string) => name === 'vscode' ? mock : nodeRequire(name), module, module.exports);
    return { run: (automatic = false) => module.exports.translate([source, ...targets] as unknown as LanguageDocument[], 'zh-CN', undefined, undefined, automatic ? { targetLanguages: options.targetLanguages ?? ['en-US'], modelId: 'auto' } : undefined),
        apply: (changes: import('../src/documents').DocumentChange[]) => { for (const change of changes) { const document = targets.find(t => t.document.uri.toString() === change.uri)!.document; document.text = applyOperations(document.text, change.operations); document.version++; } },
        source, target, requests, info, selections: () => selections, picks: () => picks };
}
test('Copilot adapter batches missing resources, preserves human translations, streams results and only returns preview changes', async () => {
    const app = await harness();
    const changes = await app.run();
    assert.equal(app.requests.length, 3, '44 missing resources produce 20 + 20 + 4 requests');
    assert.equal(changes![0].operations.length, 44);
    assert.ok(!changes![0].operations.some(op => op.key === 'Key.0'));
    assert.ok(app.requests[0].includes('Home greeting'));
    assert.equal(app.target.document.version, 1);
    assert.ok(app.target.document.getText().includes('Human translation'));
    const automatic = await harness();
    assert.equal((await automatic.run(true))![0].operations.length, 44);
    assert.equal(automatic.picks(), 0, 'explicit automated test selection skips quick picks but still uses official model discovery');
    assert.equal(automatic.selections(), 1);
});
test('Copilot missing models and declined authorization give clear failures', async () => {
    const missing = await harness({ unavailable: true }); await assert.rejects(missing.run(), /No Copilot model/);
    const declined = await harness({ fail: true }); await assert.rejects(declined.run(), /NoPermissions.*no translations were applied/);
    assert.equal(declined.requests.length, 1);
});
test('350 missing translations across 14 languages complete in 28 batches without a total limit', async () => {
    const app = await harness({ sourceCount: 25, targetLanguages: ['de', 'es', 'fr', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'ru', 'sv', 'tr', 'uk', 'zh-Hant'] });
    const changes = await app.run(true);
    assert.equal(changes!.length, 14);
    assert.equal(changes!.reduce((sum, change) => sum + change.operations.length, 0), 350);
    assert.equal(app.requests.length, 28, 'each language sends batches of 20 + 5');
    assert.equal(app.source.document.version, 1);
    app.apply(changes!);
    assert.deepEqual(await app.run(true), [], 'repeating translation skips all existing translations');
    assert.equal(app.requests.length, 28, 'no extra model requests once all translations exist');
});
test('Copilot cancellation produces no preview and source/target changes invalidate all results', async () => {
    const cancelled = await harness({ cancel: true }); assert.equal(await cancelled.run(), undefined); assert.match(cancelled.info[0], /cancelled/);
    for (const changed of ['source', 'target'] as const) { const app = await harness({ changed }); await assert.rejects(app.run(), /documents changed/); }
});
