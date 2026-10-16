// Admin page, three jobs: create a session, see a session's bookings, check people in by code.
import { api } from '../api.js';
import { h, setChildren, field, messages, loadingEl, errorEl, emptyEl, pill, withBusy, fmtDate, fmtRange, fmtFull } from '../ui.js';

const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/; // same alphabet the server uses
const pad = (n) => String(n).padStart(2, '0');

export function adminView(root) {
  let sessions = null;
  let sessionsStatus = 'loading';
  let sessionsError = '';
  let selectedId = '';

  // ======== 1. Create a session ========
  const createMsgs = messages();
  const dateCtl = h('input', { type: 'date', min: new Date().toISOString().slice(0, 10) });
  const hourCtl = h('select', null,
    h('option', { value: '' }, 'Choose a start time'),
    Array.from({ length: 24 }, (_, i) => h('option', { value: String(i) }, `${pad(i)}:00`)));
  const dateField = field('create-date', 'Date (UTC)', dateCtl);
  const hourField = field('create-hour', 'Start time (UTC)', hourCtl, 'Sessions last one hour and hold 20 people.');
  const createBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Create session');

  dateCtl.addEventListener('input', () => dateField.hasError && validateCreate());
  hourCtl.addEventListener('input', () => hourField.hasError && validateCreate());

  function validateCreate() {
    const d = dateCtl.value;
    const hr = hourCtl.value;
    const dateErr = !d ? 'Choose a date' : '';
    const hourErr = hr === '' ? 'Choose a start time' : '';
    const pastErr = !dateErr && !hourErr && Date.parse(`${d}T${pad(hr)}:00:00Z`) <= Date.now() ? 'The session must start in the future' : '';
    dateField.setError(dateErr || pastErr);
    hourField.setError(hourErr);
    return !(dateErr || hourErr || pastErr);
  }

  async function onCreate(e) {
    e.preventDefault();
    createMsgs.clear();
    if (!validateCreate()) { (dateField.hasError ? dateCtl : hourCtl).focus(); return; }
    await withBusy(createBtn, async () => {
      try {
        const s = await api.post('/sessions', { date: dateCtl.value, hour: Number(hourCtl.value) });
        createMsgs.show('success', `Session created: ${fmtFull(s.start_at)}.`);
        hourCtl.value = '';
        loadSessions({ silent: true });
      } catch (err) {
        if (err.details?.date) dateField.setError(err.details.date);
        if (err.details?.hour) hourField.setError(err.details.hour);
        if (!err.details?.date && !err.details?.hour) createMsgs.show('error', err.message);
      }
    }, 'Creating…');
  }

  // ======== 2. A session's bookings ========
  const picker = h('select', { onchange: () => { selectedId = picker.value; loadBookings(); } });
  const pickerField = field('bookings-session', 'Session', picker);
  const pickerState = h('div');
  const bookingsBox = h('div', { 'aria-live': 'polite' }, emptyEl('Choose a session to see its bookings.'));

  async function loadSessions({ silent = false } = {}) {
    if (!silent) { sessionsStatus = 'loading'; renderPicker(); }
    try {
      sessions = await api.get('/sessions');
      sessionsStatus = 'ready';
    } catch (err) {
      sessionsStatus = 'error'; sessionsError = err.message;
    }
    renderPicker();
  }

  function renderPicker() {
    pickerState.replaceChildren();
    picker.disabled = true;
    if (sessionsStatus === 'loading') {
      picker.replaceChildren(h('option', { value: '' }, 'Loading sessions…'));
    } else if (sessionsStatus === 'error') {
      picker.replaceChildren(h('option', { value: '' }, 'Could not load sessions'));
      pickerState.append(errorEl(sessionsError, () => loadSessions()));
    } else if (!sessions.length) {
      picker.replaceChildren(h('option', { value: '' }, 'No sessions yet'));
      pickerState.append(emptyEl('No sessions yet. Create one above.'));
    } else {
      picker.disabled = false;
      setChildren(picker,
        h('option', { value: '' }, 'Choose a session…'),
        sessions.map((s) => h('option', { value: String(s.id) }, `${fmtDate(s.start_at)} ${fmtRange(s.start_at).slice(0, 5)} UTC · ${s.booked}/${s.capacity}`)));
      if (!sessions.some((s) => String(s.id) === selectedId)) selectedId = '';
      picker.value = selectedId;
    }
  }

  async function loadBookings({ silent = false } = {}) {
    if (!selectedId) { bookingsBox.replaceChildren(emptyEl('Choose a session to see its bookings.')); return; }
    const id = selectedId;
    if (!silent) bookingsBox.replaceChildren(loadingEl('Loading bookings…'));
    try {
      const rows = await api.get(`/sessions/${id}/bookings`);
      if (id !== selectedId) return; // user picked another session meanwhile
      renderBookings(rows);
    } catch (err) {
      if (id === selectedId) bookingsBox.replaceChildren(errorEl(err.message, () => loadBookings()));
    }
  }

  function renderBookings(rows) {
    if (!rows.length) { bookingsBox.replaceChildren(emptyEl('Nobody has booked this session.')); return; }
    const active = rows.filter((b) => b.status === 'confirmed');
    const present = active.filter((b) => b.checked_in_at).length;
    bookingsBox.replaceChildren(
      h('p', null, `${active.length} booked, ${present} checked in.`),
      h('ul', { class: 'cards' }, rows.map((b) => h('li', { class: 'card' },
        h('div', null,
          h('p', { class: 'time' }, b.name),
          h('p', { class: 'seats' }, b.email)),
        b.status === 'cancelled' ? pill('Cancelled', 'muted') : b.checked_in_at ? pill('Checked in', 'ok') : pill('Booked', 'info')))));
  }

  // ======== 3. Check in ========
  const checkinMsgs = messages();
  const codeCtl = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '6' });
  const codeField = field('checkin-code', 'Check-in code', codeCtl, 'The 6-character code shown in the member’s My bookings page.');
  const checkinBtn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Mark present');
  const codeError = (v) => (CODE_RE.test(v) ? '' : 'Enter the 6-character code');

  codeCtl.addEventListener('input', () => {
    codeCtl.value = codeCtl.value.toUpperCase();
    if (codeField.hasError) codeField.setError(codeError(codeCtl.value.trim()));
  });

  async function onCheckin(e) {
    e.preventDefault();
    checkinMsgs.clear();
    const code = codeCtl.value.trim().toUpperCase();
    const problem = codeError(code);
    codeField.setError(problem);
    if (problem) { codeCtl.focus(); return; }
    await withBusy(checkinBtn, async () => {
      try {
        const r = await api.post('/checkin', { code });
        checkinMsgs.show('success', `Checked in: ${r.member.name} (${r.member.email}) for ${fmtFull(r.start_at)}.`);
        codeCtl.value = '';
        codeCtl.focus();
        loadSessions({ silent: true });
        if (String(r.session_id) === selectedId) loadBookings({ silent: true });
      } catch (err) {
        if (err.details?.code) codeField.setError(err.details.code);
        else checkinMsgs.show('error', err.message);
      }
    }, 'Checking in…');
  }

  // ======== page ========
  const panel = (id, title, ...children) =>
    h('section', { class: 'panel', 'aria-labelledby': id }, h('h2', { id }, title), ...children);

  root.append(
    h('h1', null, 'Admin'),
    panel('h-create', 'Create a session',
      createMsgs.el,
      h('form', { class: 'form', novalidate: true, onsubmit: onCreate }, dateField.el, hourField.el, createBtn)),
    panel('h-bookings', 'Session bookings', pickerField.el, pickerState, bookingsBox),
    panel('h-checkin', 'Check in a member',
      checkinMsgs.el,
      h('form', { class: 'form', novalidate: true, onsubmit: onCheckin }, codeField.el, checkinBtn)));

  loadSessions();
}
