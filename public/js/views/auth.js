// Login and register share one form builder.
import { api, auth } from '../api.js';
import { h, field, messages, withBusy } from '../ui.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loginView = (root, ctx) => authView(root, ctx, false);
export const registerView = (root, ctx) => authView(root, ctx, true);

function authView(root, ctx, isRegister) {
  // Client-side checks for quick feedback. The server validates again on its own.
  const rules = {
    name: (v) => (!v.trim() ? 'Enter your name' : v.trim().length > 100 ? 'Use 100 characters or fewer' : ''),
    email: (v) => (!v.trim() ? 'Enter your email' : !EMAIL_RE.test(v.trim()) ? 'Enter a valid email address' : ''),
    password: (v) => {
      if (!v) return 'Enter your password';
      if (!isRegister) return '';
      if (v.length < 8) return 'Use at least 8 characters';
      if (new TextEncoder().encode(v).length > 72) return 'Use 72 bytes or fewer';
      return '';
    },
  };

  const fields = {};
  if (isRegister) fields.name = field('name', 'Name', h('input', { type: 'text', autocomplete: 'name', maxlength: '100' }));
  fields.email = field('email', 'Email', h('input', { type: 'email', autocomplete: 'email', maxlength: '254' }));
  fields.password = field('password', 'Password',
    h('input', { type: 'password', autocomplete: isRegister ? 'new-password' : 'current-password' }),
    isRegister ? 'At least 8 characters.' : null);

  const msgs = messages();
  const notice = ctx.takeNotice();
  if (notice) msgs.show(notice.kind, notice.text);

  // Validate a field when the user leaves it (only if they typed something), and
  // re-check as they fix it so the error disappears straight away
  for (const [key, f] of Object.entries(fields)) {
    f.control.addEventListener('blur', () => { if (f.control.value) f.setError(rules[key](f.control.value)); });
    f.control.addEventListener('input', () => { if (f.hasError) f.setError(rules[key](f.control.value)); });
  }

  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, isRegister ? 'Create account' : 'Log in');

  async function onSubmit(e) {
    e.preventDefault();
    msgs.clear();
    let firstBad = null;
    for (const [key, f] of Object.entries(fields)) {
      const message = rules[key](f.control.value);
      f.setError(message);
      if (message && !firstBad) firstBad = f;
    }
    if (firstBad) { firstBad.control.focus(); return; }

    await withBusy(submit, async () => {
      try {
        const body = { email: fields.email.control.value, password: fields.password.control.value };
        if (isRegister) body.name = fields.name.control.value;
        auth.set(await api.post(isRegister ? '/auth/register' : '/auth/login', body));
        ctx.navigate('/sessions');
      } catch (err) {
        // Put the server's per-field messages next to the fields; anything else goes in the message area
        let placed = false;
        for (const [key, message] of Object.entries(err.details || {})) {
          if (fields[key]) { fields[key].setError(message); placed = true; }
        }
        if (err.code === 'EMAIL_TAKEN') { fields.email.setError(err.message); placed = true; }
        if (!placed) msgs.show('error', err.message);
        else Object.values(fields).find((f) => f.hasError)?.control.focus();
      }
    }, isRegister ? 'Creating account…' : 'Logging in…');
  }

  root.append(
    h('h1', null, isRegister ? 'Create your account' : 'Log in'),
    msgs.el,
    h('form', { class: 'form', novalidate: true, onsubmit: onSubmit },
      ...Object.values(fields).map((f) => f.el),
      submit),
    h('p', null, isRegister
      ? ['Already have an account? ', h('a', { href: '#/login' }, 'Log in')]
      : ['New here? ', h('a', { href: '#/register' }, 'Create an account')]));
}
