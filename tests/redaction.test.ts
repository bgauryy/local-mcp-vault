import test from 'node:test';
import assert from 'node:assert/strict';
import { redactRecord, redactSecret } from '../src/shared/redaction.js';

test('redacts sensitive fields recursively', () => {
  const result = redactRecord({ token: 'abcdef123456', nested: { apiKey: 'secret-value', plain: 'visible' } });
  assert.deepEqual(result, { token: 'ab••••56', nested: { apiKey: 'se••••ue', plain: 'visible' } });
});

test('redacts short secrets fully', () => {
  assert.equal(redactSecret('abc'), '••••');
});
