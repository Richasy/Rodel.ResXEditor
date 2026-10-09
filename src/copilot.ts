import * as vscode from 'vscode';
import { LanguageDocument, DocumentChange } from './documents';
import { parseResource, Operation } from './core/xml';
import { runTranslationBatches, TranslationCancelledError } from './core/translation';

export interface TranslationSummary { model: string; requestCount: number; translatedCount: number; failures: string[]; cancelled?: boolean }
export interface TranslationSelection { targetLanguages: string[]; modelId: string }
export async function translate(items: LanguageDocument[], sourceLanguage: string, keys?: string[], onComplete?: (summary: TranslationSummary) => void, selection?: TranslationSelection, live?: { token: vscode.CancellationToken; update(changes: DocumentChange[]): Promise<void> }): Promise<DocumentChange[] | undefined> {
    const source = items.find(i => i.language === sourceLanguage) ?? items[0];
    const availableTargets = items.filter(i => i !== source).map(i => ({ label: i.language, picked: true, item: i }));
    const targets = selection ? availableTargets.filter(t => selection.targetLanguages.includes(t.label)) : await vscode.window.showQuickPick(availableTargets, { canPickMany: true, title: 'Copilot: target languages (existing translations are preserved)' });
    if (!targets?.length) { return; }
    const config = vscode.workspace.getConfiguration('rodelResx', source.document.uri);
    const batchSize = config.get<number>('translationBatchSize', 20);
    const concurrency = Math.max(1, Math.min(6, config.get<number>('translationConcurrency', 3)));
    const glossary = config.get<Record<string, string>>('glossary', {});
    const sourceVersion = source.document.version;
    const sources = parseResource(source.document.getText()).entries;
    const scope = new Set(keys ?? sources.map(e => e.key));
    const changes = targets.map(t => ({ uri: t.item.document.uri.toString(), version: t.item.document.version, operations: [] as Operation[] }));
    const tasks = targets.flatMap((target, index) => {
        const resource = parseResource(target.item.document.getText());
        return sources.filter(e => !e.readonly && e.value.trim() && scope.has(e.key)).filter(e => {
            const existing = resource.entries.find(t => t.key === e.key);
            return !existing?.readonly && !existing?.value.trim();
        }).map(entry => ({ id: `${index}:${entry.key}`, key: entry.key, value: entry.value, comment: entry.comment, targetLanguage: target.item.language, index, exists: resource.entries.some(t => t.key === entry.key) }));
    });
    if (!tasks.length) { vscode.window.showInformationMessage('No missing translations in this scope.'); return []; }
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!models.length) { throw new Error('No Copilot model is available. Enable GitHub Copilot, sign in and check your subscription. Resource editing remains available.'); }
    const availableModels = models.map(model => ({ label: model.name, description: `${model.family} · ${model.id}`, model }));
    const chosen = selection ? (selection.modelId === 'auto' ? availableModels.find(m => /mini|haiku/i.test(m.model.id + m.model.family)) ?? availableModels[0] : availableModels.find(m => m.model.id === selection.modelId)) : await vscode.window.showQuickPick(availableModels, { title: `Copilot: translate ${tasks.length} resources in batches of up to ${batchSize}` });
    if (selection && !chosen) { throw new Error(`Copilot model ${selection.modelId} is not available.`); }
    if (!chosen) { return; }
    const changed = () => source.document.version !== sourceVersion || targets.some((t, index) => t.item.document.version !== changes[index].version);
    if (changed()) { throw new Error('Resource documents changed while selecting a model. Retry with the current documents.'); }
    const snapshot = (values: ReadonlyMap<string, string>) => changes.map((change, index) => ({ ...change, operations: tasks.filter(task => task.index === index && values.has(task.id)).map(task => task.exists ? { kind: 'set' as const, key: task.key, field: 'value' as const, value: values.get(task.id)! } : { kind: 'add' as const, key: task.key, value: values.get(task.id)! }) })).filter(change => change.operations.length);
    let result: Awaited<ReturnType<typeof runTranslationBatches>>;
    try {
        result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Copilot resource translation', cancellable: true }, async (progress, nativeToken) => {
            const cancellation = new vscode.CancellationTokenSource();
            const nativeSubscription = nativeToken.onCancellationRequested(() => cancellation.cancel());
            if (nativeToken.isCancellationRequested) cancellation.cancel();
            const subscription = live?.token.onCancellationRequested(() => cancellation.cancel());
            if (live?.token.isCancellationRequested) cancellation.cancel();
            const token = cancellation.token;
            try {
                progress.report({ message: 'Preparing translation batches…' });
                let previous = 0;
                return await runTranslationBatches(tasks, { sourceLanguage: source.language === 'neutral' ? sourceLanguage : source.language, glossary, batchSize: Math.max(2, Math.min(50, batchSize)), concurrency, maxInputTokens: chosen.model.maxInputTokens }, {
                    countTokens: async prompt => chosen.model.countTokens(vscode.LanguageModelChatMessage.User(prompt), token),
                    request: async prompt => {
                        const response = await chosen.model.sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
                        let output = '';
                        for await (const part of response.text) {
                            if (token.isCancellationRequested) throw new TranslationCancelledError();
                            output += part;
                            if (output.length > 200000) throw new Error('Model response exceeds limit. No translations applied.');
                        }
                        return output;
                    }
                }, () => token.isCancellationRequested, (completed, total, message) => {
                    progress.report({ message, increment: (completed - previous) * 100 / total }); previous = completed;
                }, async values => {
                    if (changed()) throw new Error('Resource documents changed during translation. Results discarded; retry with the current documents.');
                    await live?.update(snapshot(values));
                }).catch(error => { if (token.isCancellationRequested) throw new TranslationCancelledError(); throw error; });
            } finally { nativeSubscription.dispose(); subscription?.dispose(); cancellation.dispose(); }
        });
    } catch (error) {
        if (error instanceof TranslationCancelledError || (error instanceof Error && error.name === 'Canceled')) { vscode.window.showInformationMessage('Translation cancelled; no completed translations to retain.'); return; }
        if (error instanceof vscode.LanguageModelError) { throw new Error(`Copilot ${error.code}: ${error.message}. Resolve authorization or quota before retrying; no translations were applied.`); }
        throw new Error(`Copilot translation stopped: ${String(error)}. No translations were applied.`);
    }
    if (changed()) { throw new Error('Resource documents changed during translation. Results discarded; retry with the current documents.'); }
    if (result.cancelled) void vscode.window.showInformationMessage(`Translation cancelled; ${result.values.size} completed translations retained in the review preview.`);
    if (result.failures.length) { void vscode.window.showWarningMessage(`Copilot: ${result.failures.length} validation/budget failures; ${result.values.size} valid translations from ${result.requestCount} batch requests. ${result.failures.slice(0, 3).join('; ')}`); }
    onComplete?.({ model: chosen.model.id, requestCount: result.requestCount, translatedCount: result.values.size, failures: result.failures, cancelled: result.cancelled });
    return snapshot(result.values);
}
