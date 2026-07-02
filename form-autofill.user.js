// ==UserScript==
// @name         表单自动填写助手
// @namespace    https://github.com/JinRudy/tampermonkey-form-autofill
// @version      0.1.5
// @description  手动填写一次表单后保存规则，后续按域名自动回填。
// @author       wushui
// @homepageURL  https://github.com/JinRudy/tampermonkey-form-autofill
// @supportURL   https://github.com/JinRudy/tampermonkey-form-autofill/issues
// @icon         https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/assets/icon.svg
// @updateURL    https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js
// @downloadURL  https://raw.githubusercontent.com/JinRudy/tampermonkey-form-autofill/main/form-autofill.user.js
// @match        *://*/*
// @match        file:///*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'form-autofill-recorder:v1';
  const FIELD_SELECTOR = 'input, textarea, select';
  const SKIPPED_INPUT_TYPES = new Set(['button', 'file', 'hidden', 'image', 'password', 'reset', 'submit']);
  const WIDGET_ID = 'tm-form-autofill-recorder-widget';
  const PANEL_ID = 'tm-form-autofill-recorder-panel';
  const STYLE_ID = 'tm-form-autofill-recorder-style';
  const TEST_MODE = Boolean(window.__FORM_AUTOFILL_RECORDER_TEST__);
  const appliedFieldValues = new WeakMap();

  const uiState = {
    editingRule: null,
    selectedRuleId: '',
  };

  function timestampName(date = new Date()) {
    const pad = (value) => String(value).padStart(2, '0');
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('');
  }

  function currentDomain() {
    return window.location.hostname || 'local-file';
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createRule(options = {}) {
    const createdAt = nowIso();
    return {
      id: options.id || `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      name: options.name || timestampName(),
      domain: options.domain || currentDomain(),
      enabled: options.enabled !== false,
      createdAt: options.createdAt || createdAt,
      updatedAt: options.updatedAt || createdAt,
      forms: Array.isArray(options.forms) ? options.forms : [],
    };
  }

  function cloneRule(rule) {
    return JSON.parse(JSON.stringify(rule));
  }

  function createEmptyStore() {
    return { version: 1, domains: {} };
  }

  function loadStore() {
    const fallback = createEmptyStore();
    let raw = fallback;

    try {
      if (typeof GM_getValue === 'function') {
        raw = GM_getValue(STORAGE_KEY, fallback);
      } else if (window.localStorage) {
        raw = window.localStorage.getItem(STORAGE_KEY) || fallback;
      }
    } catch (error) {
      console.warn('[Form Autofill Recorder] Failed to read storage:', error);
      return fallback;
    }

    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (error) {
        console.warn('[Form Autofill Recorder] Failed to parse storage:', error);
        return fallback;
      }
    }

    if (!raw || typeof raw !== 'object') return fallback;
    if (!raw.domains || typeof raw.domains !== 'object') raw.domains = {};
    if (!raw.version) raw.version = 1;
    return raw;
  }

  function saveStore(store) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_KEY, store);
      } else if (window.localStorage) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      }
    } catch (error) {
      console.error('[Form Autofill Recorder] Failed to save storage:', error);
      throw error;
    }
  }

  function ensureDomainBucket(store, domain) {
    const key = domain || currentDomain();
    if (!store.domains[key]) store.domains[key] = { rules: [] };
    if (!Array.isArray(store.domains[key].rules)) store.domains[key].rules = [];
    return store.domains[key];
  }

  function getDomainRules(store, domain = currentDomain()) {
    const bucket = store.domains[domain];
    return bucket && Array.isArray(bucket.rules) ? bucket.rules : [];
  }

  function sanitizeForms(forms) {
    if (!Array.isArray(forms)) return [];
    return forms
      .filter((form) => form && form.selector && form.selector !== '__page__')
      .map((form) => ({
        ...form,
        fields: Array.isArray(form.fields) ? form.fields.filter((field) => field && field.selector) : [],
      }))
      .filter((form) => form.fields.length > 0);
  }

  function upsertRule(rule) {
    const normalized = createRule({
      ...rule,
      domain: rule.domain || currentDomain(),
      updatedAt: nowIso(),
      forms: sanitizeForms(rule.forms),
    });
    if (rule.id) normalized.id = rule.id;
    normalized.createdAt = rule.createdAt || normalized.createdAt;
    normalized.updatedAt = nowIso();

    const store = loadStore();
    for (const bucket of Object.values(store.domains)) {
      if (bucket && Array.isArray(bucket.rules)) {
        bucket.rules = bucket.rules.filter((item) => item.id !== normalized.id);
      }
    }

    const bucket = ensureDomainBucket(store, normalized.domain);
    bucket.rules.push(normalized);
    saveStore(store);
    return normalized;
  }

  function deleteRule(ruleId) {
    const store = loadStore();
    for (const bucket of Object.values(store.domains)) {
      if (bucket && Array.isArray(bucket.rules)) {
        bucket.rules = bucket.rules.filter((item) => item.id !== ruleId);
      }
    }
    saveStore(store);
  }

  function cssEscape(value) {
    const text = String(value);
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(text);
    return text.replace(/["\\]/g, '\\$&');
  }

  function attrEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function isUniqueSelector(element, selector) {
    try {
      const matches = Array.from(document.querySelectorAll(selector));
      return matches.length === 1 && matches[0] === element;
    } catch (_error) {
      return false;
    }
  }

  function elementSelector(element) {
    if (!element || !element.tagName) return '';
    const tag = element.tagName.toLowerCase();

    if (element.id) {
      const selector = `#${cssEscape(element.id)}`;
      if (isUniqueSelector(element, selector)) return selector;
    }

    if (element.name) {
      const nameSelector = `${tag}[name="${attrEscape(element.name)}"]`;
      if (isUniqueSelector(element, nameSelector)) return nameSelector;

      const value = element.getAttribute('value') || element.value;
      if ((fieldType(element) === 'radio' || fieldType(element) === 'checkbox') && value) {
        const valueSelector = `${nameSelector}[value="${attrEscape(value)}"]`;
        if (isUniqueSelector(element, valueSelector)) return valueSelector;
      }
    }

    return domPathSelector(element);
  }

  function domPathSelector(element) {
    const parts = [];
    let node = element;

    while (node && node.nodeType !== 9 && node !== document.body) {
      if (!node.tagName) break;
      const tag = node.tagName.toLowerCase();
      let index = 1;
      let sibling = node;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.tagName && sibling.tagName.toLowerCase() === tag) index += 1;
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
      node = node.parentElement;
    }

    return parts.length ? `body > ${parts.join(' > ')}` : '';
  }

  function fieldType(element) {
    const tag = element.tagName ? element.tagName.toLowerCase() : '';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    return (element.type || 'text').toLowerCase();
  }

  function shouldCaptureField(element) {
    if (!element || element.disabled) return false;
    if (isOwnUiElement(element)) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : '';
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag !== 'input') return false;
    return !SKIPPED_INPUT_TYPES.has(fieldType(element));
  }

  function isOwnUiElement(element) {
    return Boolean(
      element &&
        typeof element.closest === 'function' &&
        element.closest(`#${PANEL_ID}, #${WIDGET_ID}`),
    );
  }

  function fieldLabel(element) {
    const labels = element.labels ? Array.from(element.labels) : [];
    const label = labels.find((item) => item && item.textContent && item.textContent.trim());
    if (label) return label.textContent.trim();

    const parentLabel = typeof element.closest === 'function' ? element.closest('label') : null;
    if (parentLabel && parentLabel.textContent) return parentLabel.textContent.trim();

    return element.getAttribute('aria-label') || element.name || element.id || fieldType(element);
  }

  function captureField(element) {
    const type = fieldType(element);
    return {
      selector: elementSelector(element),
      name: element.name || '',
      id: element.id || '',
      type,
      tagName: element.tagName.toLowerCase(),
      label: fieldLabel(element),
      value: type === 'checkbox' || type === 'radio' ? element.value || element.getAttribute('value') || 'on' : element.value,
      checked: type === 'checkbox' || type === 'radio' ? Boolean(element.checked) : undefined,
      enabled: true,
    };
  }

  function captureRule(rule) {
    const targetRule = createRule(rule || {});
    targetRule.forms = [];
    targetRule.updatedAt = nowIso();

    const formMap = new Map();
    const fields = Array.from(document.querySelectorAll('form'))
      .filter((form) => !isOwnUiElement(form))
      .flatMap((form) => Array.from(form.querySelectorAll(FIELD_SELECTOR)))
      .filter(shouldCaptureField);

    for (const element of fields) {
      const form = typeof element.closest === 'function' ? element.closest('form') : null;
      const formSelector = form ? elementSelector(form) : '__page__';

      if (!formMap.has(formSelector)) {
        formMap.set(formSelector, {
          selector: form ? formSelector : '',
          id: form ? form.id || '' : '',
          name: form ? form.name || '' : '',
          title: form ? form.getAttribute('aria-label') || form.name || form.id || 'form' : 'page fields',
          fields: [],
        });
      }

      const snapshot = captureField(element);
      if (snapshot.selector) formMap.get(formSelector).fields.push(snapshot);
    }

    targetRule.forms = sanitizeForms(Array.from(formMap.values()).filter((form) => form.fields.length > 0));
    return targetRule;
  }

  function findField(field) {
    if (field.selector) {
      try {
        const exact = document.querySelector(field.selector);
        if (exact) return exact;
      } catch (_error) {
        // Fall through to metadata lookup.
      }
    }

    if (field.id) {
      try {
        const byId = document.querySelector(`#${cssEscape(field.id)}`);
        if (byId) return byId;
      } catch (_error) {
        // Fall through.
      }
    }

    if (field.name) {
      try {
        const candidates = Array.from(document.querySelectorAll(`${field.tagName || ''}[name="${attrEscape(field.name)}"]`));
        return (
          candidates.find((element) => {
            if (field.type && fieldType(element) !== field.type) return false;
            if ((field.type === 'radio' || field.type === 'checkbox') && field.value !== undefined) {
              return String(element.value || element.getAttribute('value') || 'on') === String(field.value);
            }
            return true;
          }) || null
        );
      } catch (_error) {
        return null;
      }
    }

    return null;
  }

  function dispatchFieldEvents(element) {
    for (const type of ['input', 'change']) {
      element.dispatchEvent(new Event(type, { bubbles: true }));
    }
  }

  function setNativeProperty(element, property, value) {
    const prototype = Object.getPrototypeOf(element);
    const prototypeDescriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, property) : null;
    const ownDescriptor = Object.getOwnPropertyDescriptor(element, property);

    if (prototypeDescriptor && typeof prototypeDescriptor.set === 'function' && prototypeDescriptor.set !== ownDescriptor?.set) {
      prototypeDescriptor.set.call(element, value);
      return;
    }

    element[property] = value;
  }

  function radioClickTarget(element) {
    const wrapper = typeof element.closest === 'function' ? element.closest('label, .ant-radio-wrapper') : null;
    if (wrapper) return wrapper;

    if (element.id) {
      try {
        const label = document.querySelector(`label[for="${attrEscape(element.id)}"]`);
        if (label) return label;
      } catch (_error) {
        // Fall through to the input.
      }
    }

    return element;
  }

  function hasClass(element, className) {
    if (!element) return false;
    if (element.classList && typeof element.classList.contains === 'function') return element.classList.contains(className);
    return String(element.className || '')
      .split(/\s+/)
      .includes(className);
  }

  function isRadioApplied(element) {
    if (!element.checked) return false;

    const wrapper = typeof element.closest === 'function' ? element.closest('label, .ant-radio-wrapper') : null;
    const antRadio = typeof element.closest === 'function' ? element.closest('.ant-radio') : null;
    const isAntdRadio = hasClass(wrapper, 'ant-radio-wrapper') || hasClass(antRadio, 'ant-radio');
    if (!isAntdRadio) return true;

    return hasClass(wrapper, 'ant-radio-wrapper-checked') || hasClass(antRadio, 'ant-radio-checked');
  }

  function captureScrollRestore(target) {
    const positions = [];
    const seen = new Set();

    function add(element) {
      if (!element || seen.has(element)) return;
      seen.add(element);
      positions.push({
        element,
        left: element.scrollLeft || 0,
        top: element.scrollTop || 0,
      });
    }

    add(document.scrollingElement || document.documentElement);

    let node = target;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) add(node);
      node = node.parentElement;
    }

    return function restoreScroll() {
      for (const position of positions) {
        position.element.scrollLeft = position.left;
        position.element.scrollTop = position.top;
      }
    };
  }

  function clickPreservingScroll(target) {
    const restoreScroll = captureScrollRestore(target);
    target.click();
    restoreScroll();
    setTimeout(restoreScroll, 0);
  }

  function documentContains(element) {
    if (!element) return false;
    if (document.documentElement && typeof document.documentElement.contains === 'function') {
      return document.documentElement.contains(element);
    }
    return element.ownerDocument === document;
  }

  function isFillableElement(element) {
    return Boolean(element && typeof element.matches === 'function' && element.matches(FIELD_SELECTOR));
  }

  function focusWithoutScroll(element) {
    if (!element || typeof element.focus !== 'function') return;
    try {
      element.focus({ preventScroll: true });
    } catch (_error) {
      element.focus();
    }
  }

  function captureAutofillSideEffectRestore() {
    const activeBefore = document.activeElement;
    const restoreScroll = captureScrollRestore(document.body || document.documentElement);
    const shouldRestoreFocus =
      activeBefore &&
      activeBefore !== document.body &&
      activeBefore !== document.documentElement &&
      documentContains(activeBefore) &&
      typeof activeBefore.focus === 'function';

    return function restoreAutofillSideEffects() {
      restoreScroll();

      const activeNow = document.activeElement;
      if (shouldRestoreFocus && activeNow !== activeBefore) {
        focusWithoutScroll(activeBefore);
      } else if (
        activeNow &&
        activeNow !== activeBefore &&
        !isOwnUiElement(activeNow) &&
        isFillableElement(activeNow) &&
        typeof activeNow.blur === 'function'
      ) {
        activeNow.blur();
      }

      restoreScroll();
      setTimeout(restoreScroll, 0);
    };
  }

  function markAppliedFieldValue(element, signature) {
    appliedFieldValues.set(element, signature);
  }

  function wasFieldValueAlreadyApplied(element, signature) {
    return appliedFieldValues.get(element) === signature;
  }

  function applyField(field) {
    if (!field || field.enabled === false) return false;
    const element = findField(field);
    if (!element || element.disabled || isOwnUiElement(element) || !shouldCaptureField(element)) return false;

    const type = fieldType(element);
    if (type === 'radio') {
      if (!field.checked) return false;
      if (isRadioApplied(element)) return true;
      const target = radioClickTarget(element);
      if (target && !isOwnUiElement(target) && typeof target.click === 'function') clickPreservingScroll(target);
      if (!element.checked) {
        setNativeProperty(element, 'checked', true);
        dispatchFieldEvents(element);
      }
      return true;
    }

    const restoreFieldScroll = captureScrollRestore(element);
    if (type === 'checkbox') {
      const nextChecked = Boolean(field.checked);
      const signature = `checked:${nextChecked}`;
      if (element.checked === nextChecked && wasFieldValueAlreadyApplied(element, signature)) return true;
      setNativeProperty(element, 'checked', nextChecked);
      markAppliedFieldValue(element, signature);
    } else {
      const nextValue = field.value == null ? '' : String(field.value);
      const signature = `value:${nextValue}`;
      if (String(element.value) === nextValue && wasFieldValueAlreadyApplied(element, signature)) return true;
      setNativeProperty(element, 'value', nextValue);
      markAppliedFieldValue(element, signature);
    }

    dispatchFieldEvents(element);
    restoreFieldScroll();
    setTimeout(restoreFieldScroll, 0);
    return true;
  }

  function applyRule(rule) {
    if (!rule || !Array.isArray(rule.forms)) return 0;
    const restoreSideEffects = captureAutofillSideEffectRestore();
    let count = 0;
    try {
      for (const form of sanitizeForms(rule.forms)) {
        for (const field of form.fields || []) {
          if (applyField(field)) count += 1;
        }
      }
    } finally {
      restoreSideEffects();
    }
    return count;
  }

  function applyEnabledRules() {
    const rules = getDomainRules(loadStore(), currentDomain()).filter((rule) => rule.enabled !== false);
    let count = 0;
    for (const rule of rules) count += applyRule(rule);
    return count;
  }

  function debounce(fn, wait) {
    let timer = null;
    return function debounced() {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  function scheduleAutofill() {
    setTimeout(applyEnabledRules, 250);
    setTimeout(applyEnabledRules, 1200);

    if (typeof MutationObserver !== 'function' || !document.body) return;
    const rerun = debounce(applyEnabledRules, 250);
    const observer = new MutationObserver(rerun);
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }

  function ensureEditingRule() {
    if (uiState.editingRule) return uiState.editingRule;

    const rules = getDomainRules(loadStore(), currentDomain());
    const preferred = rules.find((rule) => rule.enabled !== false) || rules[0];
    uiState.editingRule = preferred ? cloneRule({ ...preferred, forms: sanitizeForms(preferred.forms) }) : createRule({ domain: currentDomain() });
    uiState.selectedRuleId = preferred ? preferred.id : '';
    return uiState.editingRule;
  }

  function loadRuleIntoEditor(ruleId) {
    const store = loadStore();
    const rules = Object.values(store.domains).flatMap((bucket) => (bucket && Array.isArray(bucket.rules) ? bucket.rules : []));
    const rule = rules.find((item) => item.id === ruleId);
    uiState.editingRule = rule ? cloneRule({ ...rule, forms: sanitizeForms(rule.forms) }) : createRule({ domain: currentDomain() });
    uiState.selectedRuleId = rule ? rule.id : '';
    renderPanel();
  }

  function collectPanelValues() {
    const panel = document.getElementById(PANEL_ID);
    if (!panel || !uiState.editingRule) return;

    const rule = uiState.editingRule;
    const nameInput = panel.querySelector('[data-role="rule-name"]');
    const domainInput = panel.querySelector('[data-role="rule-domain"]');
    const enabledInput = panel.querySelector('[data-role="rule-enabled"]');
    rule.name = nameInput && nameInput.value.trim() ? nameInput.value.trim() : timestampName();
    rule.domain = domainInput && domainInput.value.trim() ? domainInput.value.trim() : currentDomain();
    rule.enabled = enabledInput ? Boolean(enabledInput.checked) : true;

    for (const fieldInput of panel.querySelectorAll('[data-field-path]')) {
      const [formIndex, fieldIndex, property] = fieldInput.dataset.fieldPath.split('.');
      const field = rule.forms[Number(formIndex)] && rule.forms[Number(formIndex)].fields[Number(fieldIndex)];
      if (!field) continue;
      if (property === 'enabled') field.enabled = Boolean(fieldInput.checked);
      if (property === 'checked') field.checked = Boolean(fieldInput.checked);
      if (property === 'value') field.value = fieldInput.value;
    }
  }

  function saveEditingRule() {
    collectPanelValues();
    uiState.editingRule = upsertRule(uiState.editingRule);
    uiState.selectedRuleId = uiState.editingRule.id;
    renderPanel('已保存');
  }

  function saveCapturedRule() {
    collectPanelValues();
    uiState.editingRule = captureRule(uiState.editingRule);
    uiState.editingRule = upsertRule(uiState.editingRule);
    uiState.selectedRuleId = uiState.editingRule.id;
    renderPanel(`已记录 ${countRuleFields(uiState.editingRule)} 个字段`);
  }

  function countRuleFields(rule) {
    return (rule.forms || []).reduce((total, form) => total + (form.fields || []).length, 0);
  }

  function html(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderFieldEditor(field, formIndex, fieldIndex) {
    const key = `${formIndex}.${fieldIndex}`;
    const checkedEditor =
      field.type === 'checkbox' || field.type === 'radio'
        ? `<label class="tmfar-check"><input type="checkbox" data-field-path="${key}.checked" ${field.checked ? 'checked' : ''}> checked</label>`
        : '';
    const valueEditor =
      field.type === 'textarea'
        ? `<textarea data-field-path="${key}.value">${html(field.value)}</textarea>`
        : `<input type="text" data-field-path="${key}.value" value="${html(field.value)}">`;

    return `
      <div class="tmfar-field">
        <label class="tmfar-enable"><input type="checkbox" data-field-path="${key}.enabled" ${field.enabled !== false ? 'checked' : ''}></label>
        <div class="tmfar-field-main">
          <div class="tmfar-field-title">${html(field.label || field.name || field.id || field.selector)}</div>
          <div class="tmfar-field-meta">${html(field.type)} · ${html(field.name || field.id || field.selector)}</div>
          <div class="tmfar-field-edit">${valueEditor}${checkedEditor}</div>
        </div>
      </div>
    `;
  }

  function renderPanel(statusText = '') {
    const rule = ensureEditingRule();
    const store = loadStore();
    const domainRules = getDomainRules(store, currentDomain());
    const allRules = Object.entries(store.domains).flatMap(([domain, bucket]) =>
      (bucket.rules || []).map((item) => ({ ...item, domainLabel: domain })),
    );
    const panel = ensurePanel();
    const selectedOption = uiState.selectedRuleId || '__draft__';

    panel.innerHTML = `
      <div class="tmfar-card">
        <div class="tmfar-header">
          <div>
            <div class="tmfar-title">表单自动填写</div>
            <div class="tmfar-subtitle">${html(currentDomain())}</div>
          </div>
          <button type="button" class="tmfar-icon-btn" data-action="close">×</button>
        </div>

        <div class="tmfar-grid">
          <label>规则
            <select data-role="rule-select">
              <option value="__draft__" ${selectedOption === '__draft__' ? 'selected' : ''}>当前草稿：${html(rule.name)}</option>
              ${allRules
                .map(
                  (item) =>
                    `<option value="${html(item.id)}" ${selectedOption === item.id ? 'selected' : ''}>${html(item.name)} (${html(item.domainLabel)})</option>`,
                )
                .join('')}
            </select>
          </label>
          <label>域名
            <input type="text" data-role="rule-domain" value="${html(rule.domain)}">
          </label>
          <label>规则名称
            <input type="text" data-role="rule-name" value="${html(rule.name)}">
          </label>
          <label class="tmfar-inline">
            <input type="checkbox" data-role="rule-enabled" ${rule.enabled !== false ? 'checked' : ''}> 启用自动填写
          </label>
        </div>

        <div class="tmfar-actions">
          <button type="button" data-action="capture">保存当前页面表单</button>
          <button type="button" data-action="save">保存面板修改</button>
          <button type="button" data-action="fill">立即回填</button>
          <button type="button" data-action="new">新规则</button>
          <button type="button" data-action="delete" ${uiState.selectedRuleId ? '' : 'disabled'}>删除</button>
        </div>

        <div class="tmfar-status">${html(statusText || `${domainRules.length} 条当前域名规则，当前规则 ${countRuleFields(rule)} 个字段`)}</div>

        <div class="tmfar-forms">
          ${
            rule.forms && rule.forms.length
              ? rule.forms
                  .map(
                    (form, formIndex) => `
                      <details open>
                        <summary>${html(form.name || form.id || form.title || `Form ${formIndex + 1}`)} · ${(form.fields || []).length} 字段</summary>
                        ${(form.fields || []).map((field, fieldIndex) => renderFieldEditor(field, formIndex, fieldIndex)).join('')}
                      </details>
                    `,
                  )
                  .join('')
              : '<div class="tmfar-empty">还没有记录字段。先手动填写页面表单，再点“保存当前页面表单”。</div>'
          }
        </div>
      </div>
    `;

    bindPanelEvents(panel);
  }

  function bindPanelEvents(panel) {
    const ruleSelect = panel.querySelector('[data-role="rule-select"]');
    if (ruleSelect) {
      ruleSelect.addEventListener('change', () => {
        if (ruleSelect.value === '__draft__') {
          uiState.editingRule = createRule({ domain: currentDomain() });
          uiState.selectedRuleId = '';
          renderPanel();
        } else {
          loadRuleIntoEditor(ruleSelect.value);
        }
      });
    }

    for (const button of panel.querySelectorAll('[data-action]')) {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'close') closePanel();
        if (action === 'capture') saveCapturedRule();
        if (action === 'save') saveEditingRule();
        if (action === 'fill') {
          collectPanelValues();
          renderPanel(`已回填 ${applyRule(uiState.editingRule)} 个字段`);
        }
        if (action === 'new') {
          uiState.editingRule = createRule({ domain: currentDomain() });
          uiState.selectedRuleId = '';
          renderPanel('已创建新规则草稿');
        }
        if (action === 'delete' && uiState.selectedRuleId) {
          deleteRule(uiState.selectedRuleId);
          uiState.editingRule = createRule({ domain: currentDomain() });
          uiState.selectedRuleId = '';
          renderPanel('已删除规则');
        }
      });
    }
  }

  function ensurePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.hidden = true;
    document.body.appendChild(panel);
    return panel;
  }

  function openPanel() {
    ensureStyle();
    ensureEditingRule();
    const panel = ensurePanel();
    panel.hidden = false;
    renderPanel();
  }

  function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = true;
  }

  function togglePanel() {
    const panel = ensurePanel();
    if (panel.hidden) openPanel();
    else closePanel();
  }

  function ensureWidget() {
    ensureStyle();
    if (document.getElementById(WIDGET_ID)) return;

    const button = document.createElement('button');
    button.id = WIDGET_ID;
    button.type = 'button';
    button.textContent = '表单';
    button.title = '打开表单自动填写';
    button.addEventListener('click', togglePanel);
    document.body.appendChild(button);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${WIDGET_ID} {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 2147483646;
        width: 48px;
        height: 48px;
        border: 0;
        border-radius: 8px;
        background: #111827;
        color: #fff;
        font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        box-shadow: 0 8px 24px rgba(0,0,0,.22);
        cursor: pointer;
      }
      #${PANEL_ID} {
        position: fixed;
        right: 18px;
        bottom: 78px;
        z-index: 2147483647;
        width: min(560px, calc(100vw - 32px));
        max-height: min(760px, calc(100vh - 96px));
        color: #111827;
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID}[hidden] { display: none; }
      #${PANEL_ID} * { box-sizing: border-box; }
      #${PANEL_ID} .tmfar-card {
        overflow: auto;
        max-height: min(760px, calc(100vh - 96px));
        border: 1px solid #d1d5db;
        border-radius: 8px;
        background: #fff;
        box-shadow: 0 20px 60px rgba(0,0,0,.25);
      }
      #${PANEL_ID} .tmfar-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 16px;
        border-bottom: 1px solid #e5e7eb;
      }
      #${PANEL_ID} .tmfar-title { font-size: 16px; font-weight: 700; }
      #${PANEL_ID} .tmfar-subtitle { margin-top: 2px; color: #6b7280; font-size: 12px; }
      #${PANEL_ID} .tmfar-icon-btn {
        width: 28px;
        height: 28px;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background: #fff;
        cursor: pointer;
      }
      #${PANEL_ID} .tmfar-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        padding: 14px 16px;
      }
      #${PANEL_ID} label { display: grid; gap: 5px; color: #374151; font-size: 12px; }
      #${PANEL_ID} .tmfar-inline {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-top: 20px;
      }
      #${PANEL_ID} input[type="text"],
      #${PANEL_ID} textarea,
      #${PANEL_ID} select {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 7px 9px;
        color: #111827;
        background: #fff;
        font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #${PANEL_ID} textarea { min-height: 62px; resize: vertical; }
      #${PANEL_ID} .tmfar-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 16px 12px;
      }
      #${PANEL_ID} .tmfar-actions button {
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 7px 10px;
        background: #f9fafb;
        color: #111827;
        cursor: pointer;
      }
      #${PANEL_ID} .tmfar-actions button:first-child {
        border-color: #2563eb;
        background: #2563eb;
        color: #fff;
      }
      #${PANEL_ID} .tmfar-actions button:disabled { cursor: not-allowed; opacity: .45; }
      #${PANEL_ID} .tmfar-status {
        margin: 0 16px 12px;
        border-radius: 6px;
        background: #f3f4f6;
        padding: 8px 10px;
        color: #4b5563;
        font-size: 12px;
      }
      #${PANEL_ID} .tmfar-forms { padding: 0 16px 16px; }
      #${PANEL_ID} details {
        border: 1px solid #e5e7eb;
        border-radius: 8px;
        margin-top: 10px;
        background: #fff;
      }
      #${PANEL_ID} summary {
        padding: 10px 12px;
        cursor: pointer;
        font-weight: 600;
      }
      #${PANEL_ID} .tmfar-field {
        display: grid;
        grid-template-columns: 26px 1fr;
        gap: 8px;
        border-top: 1px solid #f3f4f6;
        padding: 10px 12px;
      }
      #${PANEL_ID} .tmfar-enable { padding-top: 3px; }
      #${PANEL_ID} .tmfar-field-title { font-weight: 600; color: #111827; }
      #${PANEL_ID} .tmfar-field-meta {
        margin: 2px 0 7px;
        color: #6b7280;
        font-size: 12px;
      }
      #${PANEL_ID} .tmfar-field-edit {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 8px;
        align-items: center;
      }
      #${PANEL_ID} .tmfar-check {
        display: flex;
        align-items: center;
        gap: 6px;
        white-space: nowrap;
      }
      #${PANEL_ID} .tmfar-empty {
        border: 1px dashed #d1d5db;
        border-radius: 8px;
        padding: 18px;
        color: #6b7280;
        text-align: center;
      }
      @media (max-width: 620px) {
        #${PANEL_ID} .tmfar-grid { grid-template-columns: 1fr; }
        #${PANEL_ID} .tmfar-field-edit { grid-template-columns: 1fr; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function init() {
    if (typeof GM_registerMenuCommand === 'function') {
      GM_registerMenuCommand('打开表单自动填写', togglePanel);
      GM_registerMenuCommand('立即执行表单回填', applyEnabledRules);
    }
    ensureWidget();
    scheduleAutofill();
  }

  window.__FormAutofillRecorderTestApi = {
    applyEnabledRules,
    applyRule,
    captureRule,
    createRule,
    loadStore,
    saveStore,
    upsertRule,
  };

  if (TEST_MODE) return;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
