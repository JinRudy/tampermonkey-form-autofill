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
    this.clickCount = 0;
    this.disabled = Boolean(props.disabled);
    this.textContent = props.textContent || '';
    this.labels = props.labels || [];
    this.className = props.className || '';
    this.onClick = props.onClick || null;
    this.onDispatch = props.onDispatch || null;
    this.scrollTop = props.scrollTop || 0;
    this.scrollLeft = props.scrollLeft || 0;
    this.scrollHeight = props.scrollHeight || 0;
    this.scrollWidth = props.scrollWidth || 0;
    this.clientHeight = props.clientHeight || 0;
    this.clientWidth = props.clientWidth || 0;

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
    assignOwnerDocument(child, this.ownerDocument);
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'name') return this.name || null;
    if (name === 'type') return this.type || null;
    if (name === 'class') return this.className || null;
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
    if (name === 'name') this.name = String(value);
    if (name === 'type') this.type = String(value);
    if (name === 'class') this.className = String(value);
  }

  addEventListener() {}

  click() {
    this.clickCount += 1;
    if (typeof this.onClick === 'function') this.onClick(this);

    if (this.tagName.toLowerCase() === 'label') {
      const target = this.getAttribute('for')
        ? this.ownerDocument.querySelector(`#${this.getAttribute('for')}`)
        : this.querySelector('input, textarea, select');
      if (target && typeof target.click === 'function') target.click();
    }

    if (this.tagName.toLowerCase() === 'input') {
      const type = (this.type || '').toLowerCase();
      if (type === 'radio' && this.name && this.ownerDocument) {
        for (const element of this.ownerDocument.querySelectorAll(`input[name="${this.name}"]`)) {
          if ((element.type || '').toLowerCase() === 'radio') element._checked = false;
        }
        this._checked = true;
      } else if (type === 'checkbox') {
        this._checked = !this._checked;
      }
    }

    this.dispatchEvent({ type: 'click' });
    return true;
  }

  dispatchEvent(event) {
    this.eventLog.push(event.type);
    if (typeof this.onDispatch === 'function') this.onDispatch(event, this);
    return true;
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  contains(target) {
    if (this === target) return true;
    for (const child of this.children) {
      if (child.contains(target)) return true;
    }
    return false;
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
    this.activeElement = this.body;
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

function assignOwnerDocument(node, ownerDocument) {
  node.ownerDocument = ownerDocument;
  for (const child of node.children) assignOwnerDocument(child, ownerDocument);
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

  const nameValueMatch = selector.match(/^(?:([a-z]+))?\[name="([^"]+)"\]\[value="([^"]+)"\]$/i);
  if (nameValueMatch) {
    const tagOk = !nameValueMatch[1] || element.tagName.toLowerCase() === nameValueMatch[1].toLowerCase();
    return tagOk && element.name === nameValueMatch[2] && String(element.value) === nameValueMatch[3];
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

function buildControlledRadioDocument() {
  const document = new FakeDocument();
  const scrollContainer = field('div', { scrollTop: 200, scrollHeight: 1000, clientHeight: 300 });
  const form = field('form', { id: 'antd-form' });
  const personalLabel = field('label', { className: 'ant-radio-wrapper', textContent: '个人' });
  const teamLabel = field('label', { className: 'ant-radio-wrapper', textContent: '组织/团队' });
  const personal = field('input', { name: 'developerType', type: 'radio', value: '1', checked: false });
  const team = field('input', { name: 'developerType', type: 'radio', value: '2', checked: false });

  personalLabel.onClick = () => {
    personal._checked = true;
    team._checked = false;
    personalLabel.className = 'ant-radio-wrapper ant-radio-wrapper-checked';
    teamLabel.className = 'ant-radio-wrapper';
    scrollContainer.scrollTop = 999;
  };
  teamLabel.onClick = () => {
    personal._checked = false;
    team._checked = true;
    personalLabel.className = 'ant-radio-wrapper';
    teamLabel.className = 'ant-radio-wrapper ant-radio-wrapper-checked';
    scrollContainer.scrollTop = 999;
  };

  personalLabel.appendChild(personal);
  teamLabel.appendChild(team);
  form.appendChild(personalLabel);
  form.appendChild(teamLabel);
  scrollContainer.appendChild(form);
  document.body.appendChild(scrollContainer);

  return { document, fields: { personal, team, personalLabel, teamLabel, scrollContainer } };
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

assert.equal(filledCount, 5, 'fills captured fields and only applies the selected radio option');
assert.equal(fields.firstName.value, 'Alice');
assert.equal(fields.firstName.directValueSetCount, 0, 'uses native value setter instead of direct controlled setter');
assert.equal(fields.firstName.nativeValueSetCount, 1, 'native value setter receives autofill value');
assert.equal(fields.bio.value, 'hello world');
assert.equal(fields.role.value, 'admin');
assert.equal(fields.agree.checked, true);
assert.equal(fields.planFree.checked, false);
assert.equal(fields.planPro.checked, true);
assert.equal(fields.planPro.directCheckedSetCount, 0, 'radio click does not use the direct controlled setter');
assert.equal(fields.planPro.nativeCheckedSetCount, 0, 'radio click does not use the checked setter');
assert.equal(fields.planPro.clickCount, 1, 'selected radio option is applied through click');
assert.equal(fields.password.value, 'secret', 'password was not changed by capture or fill');
assert.equal(fields.csrf.value, 'token-1', 'hidden field was not changed by capture or fill');

const controlled = buildControlledRadioDocument();
const controlledApi = await loadUserscript(controlled.document);
const controlledRule = controlledApi.createRule({
  name: 'controlled-radio',
  domain: 'example.test',
  forms: [
    {
      selector: '#antd-form',
      id: 'antd-form',
      name: '',
      title: 'AntD form',
      fields: [
        {
          selector: 'input[name="developerType"][value="1"]',
          name: 'developerType',
          id: '',
          type: 'radio',
          tagName: 'input',
          label: '个人',
          value: '1',
          checked: true,
          enabled: true,
        },
        {
          selector: 'input[name="developerType"][value="2"]',
          name: 'developerType',
          id: '',
          type: 'radio',
          tagName: 'input',
          label: '组织/团队',
          value: '2',
          checked: false,
          enabled: true,
        },
      ],
    },
  ],
});

assert.equal(controlledApi.applyRule(controlledRule), 1, 'only the selected radio field counts as filled');
assert.equal(controlled.fields.personalLabel.clickCount, 1, 'selected radio uses the visible wrapper click path');
assert.equal(controlled.fields.teamLabel.clickCount, 0, 'unselected radio field does not trigger a click');
assert.equal(controlled.fields.personal.checked, true);
assert.equal(controlled.fields.team.checked, false);
assert.match(controlled.fields.personalLabel.className, /ant-radio-wrapper-checked/);
assert.equal(controlled.fields.scrollContainer.scrollTop, 200, 'radio click restores the previous scroll position');

controlled.fields.scrollContainer.scrollTop = 320;
assert.equal(controlledApi.applyRule(controlledRule), 1, 'already selected radio still counts as applied');
assert.equal(controlled.fields.personalLabel.clickCount, 1, 'already visually selected radio is not clicked again');
assert.equal(controlled.fields.scrollContainer.scrollTop, 320, 'second autofill does not move the scroll position');

const sideEffectDocument = new FakeDocument();
const sideEffectApi = await loadUserscript(sideEffectDocument);
const pageScroller = field('div', { scrollTop: 340, scrollHeight: 1400, clientHeight: 400 });
const sideEffectForm = field('form', { id: 'side-effect-form' });
const releaseDate = field('input', {
  id: 'releaseDate',
  name: 'releaseDate',
  type: 'text',
  value: '',
  onDispatch(event, element) {
    if (event.type === 'change') {
      element.focus();
      pageScroller.scrollTop = 999;
    }
  },
});
sideEffectForm.appendChild(releaseDate);
pageScroller.appendChild(sideEffectForm);
sideEffectDocument.body.appendChild(pageScroller);

const sideEffectRule = sideEffectApi.createRule({
  name: 'side-effects',
  domain: 'example.test',
  forms: [
    {
      selector: '#side-effect-form',
      id: 'side-effect-form',
      name: '',
      title: 'Side effect form',
      fields: [
        {
          selector: '#releaseDate',
          name: 'releaseDate',
          id: 'releaseDate',
          type: 'text',
          tagName: 'input',
          label: '模型发布日期',
          value: '2026-06-01',
          enabled: true,
        },
      ],
    },
  ],
});

assert.equal(sideEffectApi.applyRule(sideEffectRule), 1, 'fills a field whose change handler moves focus and scroll');
assert.equal(releaseDate.value, '2026-06-01');
assert.deepEqual(releaseDate.eventLog, ['input', 'change']);
assert.equal(sideEffectDocument.activeElement, sideEffectDocument.body, 'autofill blurs an unintentionally focused page field');
assert.equal(pageScroller.scrollTop, 340, 'autofill restores scroll changed by field events');

assert.equal(sideEffectApi.applyRule(sideEffectRule), 1, 'already applied same value still counts as filled');
assert.deepEqual(releaseDate.eventLog, ['input', 'change'], 'already applied same value does not dispatch duplicate events');

console.log('smoke test passed');
