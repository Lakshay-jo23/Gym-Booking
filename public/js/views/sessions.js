// Sessions list: browse, filter by date, book (instantly), join/leave the waitlist.
import { api } from '../api.js';
import { h, messages, loadingEl, errorEl, emptyEl, pill, fmtDate, fmtRange, dayKey } from '../ui.js';

const POLL_MS = 10000;

export function sessionsView(root, ctx) {
  const isMember = ctx.user.role === 'member';

  let sessions = null;     // null until the first load succeeds
  let status = 'loading';  // 'loading' | 'error' | 'ready'
  let errorMessage = '';
  let stale = false;       // true when a background refresh failed
  let loadId = 0;          // lets us ignore responses that are out of date
  let inflight = 0;        // bookings sent but not yet answered
  const pending = new Set(); // session ids with a waitlist request in flight
  let restoreKey = null;   // which action button should keep keyboard focus across re-renders
  let lastSignature = '';

  const msgs = messages();
  const notice = ctx.takeNotice();
  if (notice) msgs.show(notice.kind, notice.text);

  const dateInput = h('input', { id: 'filter-date', type: 'date', onchange: () => load() });
  const clearBtn = h('button', { class: 'btn', type: 'button', onclick: () => { dateInput.value = ''; load(); } }, 'Clear filter');
  const staleNote = h('p', { class: 'hint', hidden: true, role: 'status' }, 'Could not refresh. Seat counts may be out of date.');
  const listBox = h('div');

  const actionKey = (s) => `action-${s.id}`;

  // ---------- rendering ----------
  function render() {
    const signature = JSON.stringify([status, errorMessage, sessions, stale, [...pending]]);
    if (signature === lastSignature) return; // nothing changed: leave the DOM (and focus) alone
    lastSignature = signature;

    const focusKey = restoreKey || document.activeElement?.dataset?.focusKey;
    if (status === 'loading') listBox.replaceChildren(loadingEl('Loading sessions…'));
    else if (status === 'error') listBox.replaceChildren(errorEl(errorMessage, () => load()));
    else if (!sessions.length) listBox.replaceChildren(emptyEl(dateInput.value ? 'No sessions on that date.' : 'No sessions have been scheduled yet.'));
    else listBox.replaceChildren(...groupByDay(sessions).map(daySection));
    staleNote.hidden = !stale;

    if (focusKey) {
      const el = listBox.querySelector(`[data-focus-key="${focusKey}"]`);
      if (el && !el.disabled) { el.focus(); restoreKey = null; }
    }
  }

  function groupByDay(list) {
    const days = new Map();
    for (const s of list) {
      const key = dayKey(s.start_at);
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(s);
    }
    return [...days.values()];
  }

  function daySection(day) {
    return h('section', null,
      h('h2', null, fmtDate(day[0].start_at)),
      h('ul', { class: 'cards' }, day.map(card)));
  }

  function card(s) {
    const started = s.has_started || Date.parse(s.start_at) <= Date.now();
    const full = s.seats_remaining <= 0;
    let badge = null;
    if (s.i_am_booked) badge = pill('You’re booked', 'ok');
    else if (s.my_waitlist_position) badge = pill(`Waitlist: place ${s.my_waitlist_position}`, 'info');

    return h('li', { class: 'card' },
      h('div', null,
        h('p', { class: 'time' }, fmtRange(s.start_at)),
        h('p', { class: 'seats' }, started ? 'Started' : full ? 'Full' : `${s.seats_remaining} of ${s.capacity} seats left`),
        badge),
      isMember && !started ? h('div', { class: 'card-actions' }, action(s, full)) : null);
  }

  function action(s, full) {
    const label = `${fmtDate(s.start_at)} ${fmtRange(s.start_at)}`;
    const common = { 'data-focus-key': actionKey(s), type: 'button' };
    if (s.i_am_booked) return h('a', { class: 'btn', href: '#/bookings', 'data-focus-key': actionKey(s) }, 'View booking');
    if (pending.has(s.id)) return h('button', { ...common, class: 'btn', disabled: true }, 'Working…');
    if (s.my_waitlist_position) {
      return h('button', { ...common, class: 'btn', 'aria-label': `Leave waitlist for ${label}`, onclick: () => leaveWaitlist(s) }, 'Leave waitlist');
    }
    if (full) {
      return h('button', { ...common, class: 'btn', 'aria-label': `Join waitlist for ${label}`, onclick: () => joinWaitlist(s) }, 'Join waitlist');
    }
    return h('button', { ...common, class: 'btn btn-primary', 'aria-label': `Book ${label}`, onclick: () => book(s) }, 'Book');
  }

  // ---------- loading ----------
  async function load({ silent = false } = {}) {
    const id = ++loadId;
    if (!silent) { status = 'loading'; render(); }
    try {
      const data = await api.get('/sessions' + (dateInput.value ? `?date=${encodeURIComponent(dateInput.value)}` : ''));
      if (id !== loadId || inflight > 0) return; // out of date, or a booking is still waiting for its answer
      sessions = data; status = 'ready'; stale = false;
    } catch (err) {
      if (id !== loadId) return;
      if (silent && sessions) stale = true; // keep showing what we have
      else { status = 'error'; errorMessage = err.message; }
    }
    render();
  }

  // ---------- actions ----------
  // Optimistic booking: show the new seat count immediately, undo it if the server says no.
  async function book(s) {
    restoreKey = actionKey(s);
    msgs.clear();
    const original = s;
    sessions = sessions.map((x) => (x.id === s.id
      ? { ...x, booked: x.booked + 1, seats_remaining: x.seats_remaining - 1, i_am_booked: true }
      : x));
    inflight++;
    render();
    try {
      await api.post(`/sessions/${s.id}/book`);
      msgs.show('success', 'Booked! Your check-in code is under My bookings.');
    } catch (err) {
      sessions = sessions.map((x) => (x.id === s.id ? original : x)); // roll back
      msgs.show('error', err.message);
    } finally {
      inflight--;
    }
    render();
    if (inflight === 0) load({ silent: true }); // then show the server's real numbers
  }

  async function waitlistRequest(s, call, successText) {
    restoreKey = actionKey(s);
    msgs.clear();
    pending.add(s.id);
    render();
    let outcome;
    try {
      outcome = ['success', successText(await call())];
    } catch (err) {
      outcome = ['error', err.message];
    } finally {
      pending.delete(s.id);
    }
    await load({ silent: true }); // refresh first, so the message and the card agree
    msgs.show(...outcome);
    render();
  }
  const joinWaitlist = (s) => waitlistRequest(s, () => api.post(`/sessions/${s.id}/waitlist`),
    (r) => `You’re on the waitlist, place ${r.position}. You’ll be booked automatically if a seat opens.`);
  const leaveWaitlist = (s) => waitlistRequest(s, () => api.del(`/sessions/${s.id}/waitlist`),
    () => 'You’ve left the waitlist.');

  // ---------- page ----------
  root.append(
    h('h1', null, 'Sessions'),
    msgs.el,
    h('div', { class: 'toolbar' },
      h('div', { class: 'field' }, h('label', { for: 'filter-date' }, 'Filter by date (UTC)'), dateInput),
      clearBtn),
    staleNote,
    listBox);

  // If something else steals focus, stop trying to restore it to the old button
  root.addEventListener('focusin', (e) => { if (e.target.dataset?.focusKey !== restoreKey) restoreKey = null; });

  load();

  // Keep seat counts fresh without a page refresh
  const timer = setInterval(() => {
    if (!document.hidden && inflight === 0 && pending.size === 0) load({ silent: true });
  }, POLL_MS);
  const onVisible = () => { if (!document.hidden) load({ silent: true }); };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    loadId++; // ignore any response still on its way
  };
}
