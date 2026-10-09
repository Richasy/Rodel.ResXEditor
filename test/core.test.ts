import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, applyPatches, newResource, parseResource, planOperation } from '../src/core/xml';
import { canonicalLanguage, identify, resourcePath, sameGroup } from '../src/core/discovery';
import { validateTranslation, translationPrompt } from '../src/core/translation';
import { generateDesigner } from '../src/core/designer';

const original = '\uFEFF<?xml version="1.0" encoding="utf-8"?>\r\n<root>\r\n  <!-- keep this comment -->\r\n  <resheader name="version"><value>2.0</value></resheader>\r\n  <metadata name="other"><value>untouched</value></metadata>\r\n  <data xml:space="preserve" name=\'Hello\'><value><![CDATA[Hello {0}]]></value><comment>Context &amp; hint</comment></data>\r\n  <data name="Image" type="System.Drawing.Bitmap, System.Drawing"><value>AA==</value></data>\r\n</root>\r\n';
test('patch changes only target content, preserves BOM, CRLF, attributes, metadata and binary nodes', () => {
    const parsed = parseResource(original);
    assert.equal(parsed.entries[0].comment, 'Context & hint');
    assert.equal(parsed.entries[1].readonly, true);
    const patches = planOperation(parsed, { kind: 'set', key: 'Hello', field: 'value', value: '你好 {0}' });
    const updated = applyPatches(original, patches);
    assert.equal(updated, original.replace('<![CDATA[Hello {0}]]>', '<![CDATA[你好 {0}]]>'));
});
test('attribute rename preserves original quote style and escaping', () => {
    const result = applyOperations(original, [{ kind: 'rename', key: 'Hello', newKey: 'A\'"&<\n' }]);
    assert.equal(parseResource(result).entries[0].key, 'A\'"&<\n');
    assert.ok(result.includes("name='A&apos;&quot;&amp;&lt;&#10;'"));
});
test('add, edit multiline and remove retain untouched bytes', () => {
    let text = applyOperations(original, [{ kind: 'add', key: 'New', value: 'a\r\nb\n<c>&', comment: 'new' }]);
    assert.equal(parseResource(text).entries.find(e => e.key === 'New')!.value, 'a\r\nb\n<c>&');
    assert.ok(text.includes('  <data name="New"'));
    text = applyOperations(text, [{ kind: 'delete', key: 'New' }]);
    assert.ok(text.includes('<!-- keep this comment -->'));
    assert.deepEqual(parseResource(text).entries.map(e => e.key), ['Hello', 'Image']);
});
test('empty value element, missing comment, CDATA closing sequence', () => {
    let text = '<root><data name="x" xml:space="preserve"><value /></data></root>';
    text = applyOperations(text, [{ kind: 'set', key: 'x', field: 'value', value: 'a<&' }, { kind: 'set', key: 'x', field: 'comment', value: 'note' }]);
    assert.equal(parseResource(text).entries[0].value, 'a<&');
    assert.equal(parseResource(text).entries[0].comment, 'note');
    const cdata = applyOperations(original, [{ kind: 'set', key: 'Hello', field: 'value', value: ']]>' }]);
    assert.equal(parseResource(cdata).entries[0].value, ']]>');
});
test('duplicate keys, non-text, nested content and invalid XML are safely blocked', () => {
    const duplicate = '<root><data name="a"><value>1</value></data><data name="a"><value>2</value></data></root>';
    assert.deepEqual(parseResource(duplicate).duplicates, ['a']);
    assert.throws(() => applyOperations(duplicate, [{ kind: 'delete', key: 'a' }]));
    assert.throws(() => applyOperations(original, [{ kind: 'delete', key: 'Image' }]));
    const nested = '<root><data name="a"><value><b>text</b></value></data></root>';
    assert.ok(parseResource(nested).entries[0].readonly);
    for (const xml of ['<root><data></root>', '<!DOCTYPE root><root></root>', '<root>\n<<<<<<< HEAD\n</root>', '<root><data name="x"><value>&unknown;</value></data></root>']) assert.throws(() => parseResource(xml));
    assert.throws(() => applyOperations(newResource(), [{ kind: 'add', key: 'x', value: '\u0000' }]));
    assert.throws(() => applyOperations(newResource(), [{ kind: 'add', key: 'x', value: '\uD800' }]));
});
test('language discovery isolates each mapping and project, supports both resource layouts', () => {
    assert.equal(identify('C:/app/Strings/zh-CN/Resources.resw').language, 'zh-CN');
    assert.ok(sameGroup('C:/app/Strings/zh-CN/Resources.resw', 'C:/app/Strings/en-US/Resources.resw'));
    assert.ok(!sameGroup('C:/app/Strings/zh-CN/Resources.resw', 'C:/app/Strings/en-US/Errors.resw'));
    assert.ok(!sameGroup('C:/app/Strings/zh-CN/Resources.resw', 'C:/other/Strings/en-US/Resources.resw'));
    assert.ok(sameGroup('C:/app/Resources.resx', 'C:/app/Resources.zh-Hant.resx'));
    assert.ok(sameGroup('C:/app/My.Resources.resx', 'C:/app/My.Resources.fr.resx'));
    assert.ok(!sameGroup('C:/app/Resources.resx', 'C:/app/Errors.fr.resx'));
    assert.equal(identify('C:/app/test.resw').language, 'neutral');
    assert.equal(canonicalLanguage('zh-cn'), 'zh-CN');
    for (const language of ['../en', 'en_US', '', 'fake-language-code']) assert.throws(() => canonicalLanguage(language));
});
test('creation makes only requested language and validates file names', () => {
    const target = resourcePath('C:/app/Strings', 'Resources', 'resw', 'zh-CN');
    assert.ok(target.endsWith('zh-CN\\Resources.resw') || target.endsWith('zh-CN/Resources.resw'));
    assert.ok(!target.includes('en-US'));
    for (const name of ['../Resources', 'CON', 'thing.', 'a:b']) assert.throws(() => resourcePath('C:/app', name, 'resx', 'fr'));
    assert.equal(parseResource(newResource()).entries.length, 0);
});
test('translation validator protects placeholder multiplicity, formats, markup and exact newlines', () => {
    const source = '<b>Hello {0:N2} {name} %s</b>\r\nnext\\n';
    assert.equal(validateTranslation(source, '<b>你好 {name} {0:N2} %s</b>\r\n下一行\\n'), '<b>你好 {name} {0:N2} %s</b>\r\n下一行\\n');
    for (const value of ['<b>Hi {0} {name} %s</b>\r\nnext\\n', '<b>Hi {0:N2} {name} %s</b>\nnext\\n', '', null]) assert.throws(() => validateTranslation(source, value));
    assert.throws(() => validateTranslation('{0} {0}', '{0}'));
    assert.ok(translationPrompt({ key: 'x', value: 'Hello', comment: 'Button', sourceLanguage: 'en', targetLanguage: 'zh', glossary: {} }).includes('Button'));
});
test('Designer escapes C# keyword identifiers and rejects member collisions and non-text', () => {
    const xml = applyOperations(newResource(), [{ kind: 'add', key: 'class', value: 'x' }]);
    const code = generateDesigner(xml, 'Test.namespace', 'Strings', 'Test.Strings');
    assert.ok(code.includes('namespace @Test.@namespace'));
    assert.ok(code.includes('string @class'));
    assert.throws(() => generateDesigner(original, 'Test', 'Resources', 'Test.Resources'));
    assert.throws(() => generateDesigner(applyOperations(newResource(), [{ kind: 'add', key: 'Culture' }]), 'Test', 'Strings', 'Test.Strings'));
});
