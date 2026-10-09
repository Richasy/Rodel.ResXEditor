import * as vscode from 'vscode';
import { LanguageDocument, DocumentChange } from './documents';
import { parseResource, Operation } from './core/xml';
import { translationPrompt, validateTranslation } from './core/translation';

export async function translate(items: LanguageDocument[], sourceLanguage: string, keys?: string[]): Promise<DocumentChange[] | undefined> {
    const source = items.find(i => i.language === sourceLanguage) ?? items[0];
    const sources = parseResource(source.document.getText()).entries;
    const scope = keys ? keys : sources.map(e => e.key);
    const targets = await vscode.window.showQuickPick(items.filter(i => i !== source).map(i => ({ label: i.language, picked: true, item: i })), { canPickMany: true, title: 'Copilot: target languages (existing translations are preserved)' });
    if (!targets?.length) { return; }
    const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (!models.length) { throw new Error('No Copilot model is available. Enable GitHub Copilot, sign in and check your subscription. Resource editing remains available.'); }
    const chosen = await vscode.window.showQuickPick(models.map(model => ({ label: model.name, description: `${model.family} · ${model.id}`, model })), { title: 'Select Copilot translation model' });
    if (!chosen) { return; }
    const config = vscode.workspace.getConfiguration('rodelResx', source.document.uri);
    const limit = config.get<number>('translationLimit', 100);
    const glossary = config.get<Record<string, string>>('glossary', {});
    const changes = targets.map(t => ({ uri: t.item.document.uri.toString(), version: t.item.document.version, operations: [] as Operation[] }));
    const tasks = targets.flatMap((target, index) => {
        const resource = parseResource(target.item.document.getText());
        return sources.filter(e => !e.readonly && e.value.trim() && scope.includes(e.key)).filter(e => {
            const existing = resource.entries.find(t => t.key === e.key);
            return !existing?.readonly && !existing?.value.trim();
        }).map(entry => ({ index, entry, target: target.item, exists: resource.entries.some(t => t.key === entry.key) }));
    });
    if (tasks.length > limit) { throw new Error(`${tasks.length} requests exceed the configured limit ${limit}. Select fewer keys or languages.`); }
    if (!tasks.length) { vscode.window.showInformationMessage('No missing translations in this scope.'); return []; }
    const sourceVersion = source.document.version;
    const failures: string[] = [];
    const cancelled = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Copilot resource translation', cancellable: true }, async (progress, token) => {
        for (const task of tasks) {
            if (token.isCancellationRequested) { return true; }
            progress.report({ message: `${task.entry.key} → ${task.target.language}`, increment: 100 / tasks.length });
            try {
                const prompt = translationPrompt({ key: task.entry.key, value: task.entry.value, comment: task.entry.comment, sourceLanguage: source.language === 'neutral' ? sourceLanguage : source.language, targetLanguage: task.target.language, glossary });
                const message = vscode.LanguageModelChatMessage.User(prompt);
                if (await chosen.model.countTokens(message, token) > chosen.model.maxInputTokens - 1024) { throw new Error('Resource exceeds model input limit.'); }
                const response = await chosen.model.sendRequest([message], {}, token);
                let output = '';
                for await (const part of response.text) { output += part; if (output.length > 100000) { throw new Error('Model response exceeds limit.'); } }
                const json = JSON.parse(output.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as { value?: unknown };
                const value = validateTranslation(task.entry.value, json.value);
                changes[task.index].operations.push(task.exists ? { kind: 'set', key: task.entry.key, field: 'value', value } : { kind: 'add', key: task.entry.key, value });
            } catch (error) {
                if (token.isCancellationRequested) { return true; }
                if (error instanceof vscode.LanguageModelError) { throw new Error(`Copilot ${error.code}: ${error.message}. Retry after resolving authorization or quota; no translations were applied.`); }
                failures.push(`${task.entry.key}: ${String(error)}`);
            }
        }
        return false;
    });
    if (cancelled) { vscode.window.showInformationMessage('Translation cancelled; no changes applied.'); return; }
    if (source.document.version !== sourceVersion) { throw new Error('Source language changed during translation. Results discarded; retry with the current source.'); }
    if (failures.length) { vscode.window.showWarningMessage(`${failures.length} translations failed validation. ${failures.slice(0, 3).join('; ')}`); }
    return changes.filter(c => c.operations.length);
}
