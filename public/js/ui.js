// Small helpers shared by every view. No framework: just DOM functions.

// h('div', { class: 'x', onclick: fn }, 'text', childElement)  ->  a DOM element.
// Text is always added as text nodes (never HTML), so user data can't inject markup.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === false || value == null) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Replace an element's contents. Unlike el.replaceChildren(), this flattens arrays and skips
// null/false, so you can pass lists and conditionals (cond && element) safely.
export function setChildren(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}

// ---- dates: everything is UTC, matching how the server stores sessions ----
const dateFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
export const HOUR_MS = 3600000;
export const fmtDate = (iso) => dateFmt.format(new Date(iso));
export const fmtRange = (iso) => `${timeFmt.format(new Date(iso))}–${timeFmt.format(new Date(Date.parse(iso) + HOUR_MS))} UTC`;
export const fmtFull = (iso) => `${fmtDate(iso)}, ${fmtRange(iso)}`;
export const dayKey = (iso) => iso.slice(0, 10);

// ---- the four states every data screen needs: loading, error, empty (success is the real content) ----
export const loadingEl = (text = 'Loading…') => h('p', { class: 'state', role: 'status' }, text);
export const emptyEl = (text) => h('p', { class: 'state' }, text);
export function errorEl(message, onRetry) {
  return h('div', { class: 'state state-error', role: 'alert' },
    h('p', null, 'Error: ' + message),
    onRetry && h('button', { class: 'btn', type: 'button', onclick: onRetry }, 'Try again'));
}

export const pill = (text, kind) => h('span', { class: `pill pill-${kind}` }, text);

// A message area. Errors use role="alert" and start with the word "Error", so
// they never depend on colour alone.
export function messages() {
  const el = h('div', { class: 'messages', tabindex: '-1' });
  return {
    el,
    show(kind, text) {
      el.replaceChildren(h('p', { class: `msg msg-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
        kind === 'error' ? 'Error: ' + text : text));
    },
    clear() { el.replaceChildren(); },
  };
}

// A labelled form control with an inline error slot.
// control is an <input> or <select> you created; this wires up id, label, hint and error.
export function field(id, labelText, control, hint) {
  control.id = id;
  control.setAttribute('aria-describedby', (hint ? `${id}-hint ` : '') + `${id}-error`);
  const error = h('p', { id: `${id}-error`, class: 'field-error', hidden: true });
  const el = h('div', { class: 'field' },
    h('label', { for: id }, labelText),
    hint && h('p', { id: `${id}-hint`, class: 'hint' }, hint),
    control,
    error);
  return {
    el,
    control,
    get hasError() { return !error.hidden; },
    setError(message) {
      error.textContent = message ? 'Error: ' + message : '';
      error.hidden = !message;
      if (message) control.setAttribute('aria-invalid', 'true');
      else control.removeAttribute('aria-invalid');
    },
  };
}

// Disables a button while an async action runs, so it can't be double-submitted.
export async function withBusy(button, fn, busyText) {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  if (busyText) button.textContent = busyText;
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = original;
  }
}
