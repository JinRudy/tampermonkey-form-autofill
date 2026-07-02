import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '../form-autofill.user.js');
const source = await readFile(scriptPath, 'utf8');

function metadataValue(key) {
  const match = source.match(new RegExp(`^// @${key}\\s+(.+)$`, 'm'));
  return match ? match[1].trim() : '';
}

assert.equal(metadataValue('version'), '0.1.5');
assert.equal(metadataValue('name'), '表单自动填写助手');
assert.equal(metadataValue('namespace'), 'https://github.com/JinRudy/tampermonkey-form-autofill');
assert.equal(metadataValue('description'), '手动填写一次表单后保存规则，后续按域名自动回填。');
assert.equal(metadataValue('author'), 'wushui');
assert.equal(metadataValue('homepageURL'), 'https://github.com/JinRudy/tampermonkey-form-autofill');
assert.equal(metadataValue('supportURL'), 'https://github.com/JinRudy/tampermonkey-form-autofill/issues');
assert.equal(
  metadataValue('icon'),
  'https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/assets/icon.svg',
);
assert.equal(
  metadataValue('updateURL'),
  'https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js',
);
assert.equal(
  metadataValue('downloadURL'),
  'https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js',
);

console.log('metadata test passed');
