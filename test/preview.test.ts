import test from 'node:test';
import assert from 'node:assert/strict';
import { editedPreview, previewRowId } from '../src/core/preview';
import type { DocumentChange } from '../src/documents';

const changes: DocumentChange[] = [
    { uri: 'file:///en/Resources.resw', version: 3, operations: [{ kind: 'add', key: 'Greeting', value: '<b>Hello {name}</b>\r\nWelcome', comment: 'Retain comment' }] },
    { uri: 'file:///fr/Resources.resw', version: 4, operations: [{ kind: 'set', key: 'Greeting', field: 'value', value: '<b>Bonjour {name}</b>\r\nBienvenue' }] }
];
const id = previewRowId(changes[0].uri, changes[0].operations[0]);
const other = previewRowId(changes[1].uri, changes[1].operations[0]);

test('edited multilingual preview applies selected corrections with versions and comments intact', () => {
    const value = '<b>Hi {name}</b>\r\nWelcome back';
    const result = editedPreview(changes, [id], { [id]: value }, true);
    assert.equal(result.length, 1);
    assert.deepEqual(result[0], { uri: changes[0].uri, version: 3, operations: [{ kind: 'add', key: 'Greeting', value, comment: 'Retain comment' }] });
    assert.equal(changes[0].operations[0].kind === 'add' && changes[0].operations[0].value, '<b>Hello {name}</b>\r\nWelcome');
});
test('invalid edited translations cannot enter an atomic preview application', () => {
    for (const value of ['Hello', '<b>Hello {name}</b>\nWelcome', '<i>Hello {name}</i>\r\nWelcome', '', 'Hello\u0000']) {
        assert.throws(() => editedPreview(changes, [id, other], { [id]: value }, true));
    }
    assert.equal(editedPreview(changes, [other], { [id]: 'Bad unchecked draft' }, true).length, 1);
});
test('preview rejects unknown identities and non-string replacements, while Excel edits permit changed formatting', () => {
    assert.throws(() => editedPreview(changes, undefined, { unknown: 'Wrong row' }));
    assert.throws(() => editedPreview(changes, ['unknown']));
    assert.throws(() => editedPreview(changes, [id], { [id]: 42 }));
    assert.throws(() => editedPreview(changes, [id], []));
    assert.equal(editedPreview(changes, [id], { [id]: 'Revised Excel value' })[0].operations[0].kind, 'add');
});
