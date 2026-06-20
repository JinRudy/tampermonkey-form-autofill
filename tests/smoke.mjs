import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, '../form-autofill.user.js');

class FakeElement {
  constructor(tagName, props = {}) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.ownerDocument = null;
    this.attributes = new Map();
    this.eventLog = [];
    this.id = props.id || '';
    this.name = props.name || '';
    this.type = props.type || '';
    this._value = props.value || '';
    this._checked = Boolean(props.checked);
    this.nativeValueSetCount = 0;
    this.nativeCheckedSetCount = 0;
    this.directValueSetCount = 0;
    this.directCheckedSetCount = 0;
    this.disabled = Boolean(props.disabled);
    this.textContent = props.textContent || '';
    this.labels = props.labels || [];

    for (const [key, value] of Object.entries(props.attributes || {})) {
      this.setAttribute(key, value);
    }
  }

  get value() {
    return this._value;
  }

  set value(value) {
    this.nativeValueSetCount += 1;
    this._value = String(value);
  }

  get checked() {
    return this._checked;
  }

  set checked(value) {
    this.nativeCheckedSetCount += 1;
    this._checked = Boolean(value);
  }

  appendChild(child) {
    child.parentElement = this;
    child.ownerDocument = this.ownerDocument;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'name') return this.name || null;
    if (name === 'type') return this.type || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'name') this.name = String(value);
    if (name === 'type') this.type = String(value);
  }

  addEventListener() {}

  dispatchEvent(event) {
    this.eventLog.push(event.type);
    return true;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    for (const node of walk(this)) {
      if (node !== this && node.matches(selector)) results.push(node);
    }
    return results;
  }

  matches(selector) {
    return selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => matchesSingleSelector(this, part));
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document');
    this.ownerDocument = this;
    this.readyState = 'complete';
    this.body = new FakeElement('body');
    this.body.ownerDocument = this;
    this.documentElement = new FakeElement('html');
    this.documentElement.ownerDocument = this;
    this.documentElement.appendChild(this.body);
    this.children = [this.documentElement];
  }

  createElement(tagName) {
    const element = new FakeElement(tagName);
    element.ownerDocument = this;
    return element;
  }

  addEventListener() {}
}

function* walk(node) {
  for (const child of node.children) {
    yield child;
    yield* walk(child);
  }
}

function matchesSingleSelector(element, selector) {
  if (!selector) return false;
  if (selector === '*') return true;
  if (selector.startsWith('#')) return element.id === selector.slice(1);

  const idMatch = selector.match(/^([a-z]+)#(.+)$/i);
  if (idMatch) {
    return element.tagName.toLowerCase() === idMatch[1].toLowerCase() && element.id === idMatch[2];
  }

  const nameMatch = selector.match(/^(?:([a-z]+))?\[name="([^"]+)"\]$/i);
  if (nameMatch) {
    const tagOk = !nameMatch[1] || element.tagName.toLowerCase() === nameMatch[1].toLowerCase();
    return tagOk && element.name === nameMatch[2];
  }

  return element.tagName.toLowerCase() === selector.toLowerCase();
}

function field(tagName, props = {}) {
  return new FakeElement(tagName, props);
}

function markControlledValue(element) {
  Object.defineProperty(element, 'value', {
    configurable: true,
    get() {
      return this._value;
    },
    set(value) {
      this.directValueSetCount += 1;
      this._value = String(value);
    },
  });
}

function markControlledChecked(element) {
  Object.defineProperty(element, 'checked', {
    configurable: true,
    get() {
      return this._checked;
    },
    set(value) {
      this.directCheckedSetCount += 1;
      this._checked = Boolean(value);
    },
  });
}

function buildDocument() {
  const document = new FakeDocument();

  const profileForm = field('form', { id: 'profile-form', name: 'profileForm' });
  const firstName = field('input', { id: 'firstName', name: 'firstName', type: 'text', value: 'Alice' });
  const password = field('input', { id: 'password', name: 'password', type: 'password', value: 'secret' });
  const csrf = field('input', { name: 'csrfToken', type: 'hidden', value: 'token-1' });
  const bio = field('textarea', { id: 'bio', name: 'bio', value: 'hello world' });
  const role = field('select', { id: 'role', name: 'role', value: 'admin' });
  profileForm.appendChild(firstName);
  profileForm.appendChild(password);
  profileForm.appendChild(csrf);
  profileForm.appendChild(bio);
  profileForm.appendChild(role);

  const preferencesForm = field('form', { id: 'preferences', name: 'preferencesForm' });
  const agree = field('input', { id: 'agree', name: 'agree', type: 'checkbox', value: 'yes', checked: true });
  const planFree = field('input', { id: 'planFree', name: 'plan', type: 'radio', value: 'free', checked: false });
  const planPro = field('input', { id: 'planPro', name: 'plan', type: 'radio', value: 'pro', checked: true });
  const disabledNote = field('input', { id: 'disabledNote', name: 'disabledNote', type: 'text', value: 'skip', disabled: true });
  preferencesForm.appendChild(agree);
  preferencesForm.appendChild(planFree);
  preferencesForm.appendChild(planPro);
  preferencesForm.appendChild(disabledNote);

  document.body.appendChild(profileForm);
  document.body.appendChild(preferencesForm);

  return {
    document,
    fields: { firstName, password, csrf, bio, role, agree, planFree, planPro, disabledNote },
  };
}

async function loadUserscript(document) {
  const source = await readFile(scriptPath, 'utf8');
  const gmStore = new Map();
  const window = {
    __FORM_AUTOFILL_RECORDER_TEST__: true,
    document,
    location: { hostname: 'example.test', href: 'https://example.test/app/profile' },
    CSS: { escape: (value) => String(value).replace(/"/g, '\\"') },
    Event: class Event {
      constructor(type, options = {}) {
        this.type = type;
        this.bubbles = Boolean(options.bubbles);
      }
    },
  };

  const context = vm.createContext({
    window,
    document,
    location: window.location,
    CSS: window.CSS,
    Event: window.Event,
    console,
    setTimeout,
    clearTimeout,
    MutationObserver: class MutationObserver {
      observe() {}
      disconnect() {}
    },
    GM_getValue: (key, fallback) => gmStore.get(key) ?? fallback,
    GM_setValue: (key, value) => gmStore.set(key, value),
    GM_registerMenuCommand: () => {},
  });

  vm.runInContext(source, context, { filename: scriptPath });
  return window.__FormAutofillRecorderTestApi;
}

const { document, fields } = buildDocument();
const api = await loadUserscript(document);

assert.ok(api, 'userscript exposes test API');

const pluginPanel = field('div', { id: 'tm-form-autofill-recorder-panel' });
for (let i = 0; i < 20; i += 1) {
  pluginPanel.appendChild(field('input', { name: `pluginField${i}`, type: 'text', value: `plugin-${i}` }));
}
document.body.appendChild(pluginPanel);

const rule = api.createRule({ name: '20260621112233', domain: 'example.test' });
const captured = JSON.parse(JSON.stringify(api.captureRule(rule)));

assert.equal(captured.forms.length, 2, 'captures multiple forms');
assert.ok(
  captured.forms.every((form) => form.selector && form.title !== 'page fields'),
  'captures only real forms and does not create page fields',
);

const capturedFields = captured.forms.flatMap((form) => form.fields);
assert.deepEqual(
  capturedFields.map((item) => item.name || item.id).sort(),
  ['agree', 'bio', 'firstName', 'plan', 'plan', 'role'].sort(),
  'captures supported fields and skips sensitive or disabled fields',
);

markControlledValue(fields.firstName);
markControlledChecked(fields.planPro);
fields.firstName._value = '';
fields.bio.value = '';
fields.role.value = 'viewer';
fields.agree.checked = false;
fields.planFree.checked = true;
fields.planPro._checked = false;
fields.firstName.nativeValueSetCount = 0;
fields.firstName.directValueSetCount = 0;
fields.planPro.nativeCheckedSetCount = 0;
fields.planPro.directCheckedSetCount = 0;

const filledCount = api.applyRule(captured);

assert.equal(filledCount, 6, 'fills all captured fields');
assert.equal(fields.firstName.value, 'Alice');
assert.equal(fields.firstName.directValueSetCount, 0, 'uses native value setter instead of direct controlled setter');
assert.equal(fields.firstName.nativeValueSetCount, 1, 'native value setter receives autofill value');
assert.equal(fields.bio.value, 'hello world');
assert.equal(fields.role.value, 'admin');
assert.equal(fields.agree.checked, true);
assert.equal(fields.planFree.checked, false);
assert.equal(fields.planPro.checked, true);
assert.equal(fields.planPro.directCheckedSetCount, 0, 'uses native checked setter instead of direct controlled setter');
assert.equal(fields.planPro.nativeCheckedSetCount, 1, 'native checked setter receives autofill state');
assert.equal(fields.password.value, 'secret', 'password was not changed by capture or fill');
assert.equal(fields.csrf.value, 'token-1', 'hidden field was not changed by capture or fill');

console.log('smoke test passed');
