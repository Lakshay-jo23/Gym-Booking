// My bookings: see check-in codes, cancel with a confirm step.
import { api } from '../api.js';
import { h, setChildren, messages, loadingEl, errorEl, emptyEl, pill, fmtDate, fmtRange, HOUR_MS } from '../ui.js';

export function bookingsView(root) {
  let rows = null;
  let status = 'loading';
  let errorMessage = '';
  let confirmingId = null;     // booking showing "Cancel this booking?"
  const busy = new Set();      // booking ids being cancelled
  let loadId = 0;

  const msgs = messages();
  const box = h('div');

  const isUpcoming = (b) => b.status === 'confirmed' && Date.parse(b.start_at) > Date.now();
  const isCurrentOrUpcoming = (b) => b.status === 'confirmed' && Date.parse(b.start_at) + HOUR_MS > Date.now();

  function render() {
    if (status === 'loading') return box.replaceChildren(loadingEl('Loading your bookings…'));
    if (status === 'error') return box.replaceChildren(errorEl(errorMessage, () => load()));
    if (!rows.length) {
      return box.replaceChildren(emptyEl('You have no bookings yet.'), h('a', { class: 'btn btn-primary', href: '#/sessions' }, 'Find a session'));
    }
    const upcoming = rows.filter(isCurrentOrUpcoming).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const earlier = rows.filter((b) => !isCurrentOrUpcoming(b));
    setChildren(box,
      h('h2', null, 'Upcoming'),
      upcoming.length ? h('ul', { class: 'cards' }, upcoming.map(card)) : emptyEl('Nothing coming up.'),
      earlier.length ? [h('h2', null, 'Earlier and cancelled'), h('ul', { class: 'cards' }, earlier.map(card))] : null);
  }

  function statusPill(b) {
    if (b.status === 'cancelled') return pill('Cancelled', 'muted');
    if (b.checked_in_at) return pill('Checked in', 'ok');
    if (!isCurrentOrUpcoming(b)) return pill('Past', 'muted');
    return pill('Confirmed', 'info');
  }

  function card(b) {
    const showCode = b.status === 'confirmed' && !b.checked_in_at && isCurrentOrUpcoming(b);
    return h('li', { class: 'card' },
      h('div', null,
        h('p', { class: 'time' }, `${fmtDate(b.start_at)}, ${fmtRange(b.start_at)}`),
        statusPill(b),
        showCode && h('p', null, 'Check-in code: ', h('span', { class: 'code' }, b.checkin_code))),
      isUpcoming(b) ? h('div', { class: 'card-actions' }, cancelControls(b)) : null);
  }

  function cancelControls(b) {
    if (busy.has(b.id)) return h('button', { class: 'btn', type: 'button', disabled: true }, 'Cancelling…');
    if (confirmingId === b.id) {
      return h('div', { class: 'confirm', role: 'group', 'aria-label': 'Confirm cancellation' },
        h('span', null, 'Cancel this booking?'),
        h('button', { class: 'btn btn-danger', type: 'button', onclick: () => doCancel(b) }, 'Yes, cancel'),
        h('button', { class: 'btn', type: 'button', 'data-keep': b.id, onclick: () => { confirmingId = null; render(); box.querySelector(`[data-cancel="${b.id}"]`)?.focus(); } }, 'Keep booking'));
    }
    return h('button', {
      class: 'btn', type: 'button', 'data-cancel': b.id,
      'aria-label': `Cancel booking on ${fmtDate(b.start_at)} ${fmtRange(b.start_at)}`,
      onclick: () => { confirmingId = b.id; render(); box.querySelector(`[data-keep="${b.id}"]`)?.focus(); },
    }, 'Cancel booking');
  }

  // Returns true if the list is now up to date
  async function load({ silent = false } = {}) {
    const id = ++loadId;
    if (!silent) { status = 'loading'; render(); }
    try {
      const data = await api.get('/bookings/mine');
      if (id !== loadId) return false;
      rows = data; status = 'ready';
    } catch (err) {
      if (id !== loadId) return false;
      if (!(silent && rows)) { status = 'error'; errorMessage = err.message; }
      render();
      return false;
    }
    render();
    return true;
  }

  async function doCancel(b) {
    confirmingId = null;
    busy.add(b.id);
    msgs.clear();
    render();
    let outcome;
    try {
      await api.del(`/bookings/${b.id}`);
      outcome = ['success', 'Booking cancelled.'];
    } catch (err) {
      outcome = ['error', err.message];
    } finally {
      busy.delete(b.id);
    }
    const refreshed = await load({ silent: true }); // refresh first, so the message and the list agree
    msgs.show(outcome[0], refreshed ? outcome[1] : `${outcome[1]} (The list could not be refreshed. Reload the page.)`);
    msgs.el.focus(); // the button is gone; put focus where the result is announced
  }

  root.append(h('h1', null, 'My bookings'), msgs.el, box);
  load();
  return () => { loadId++; };
}
