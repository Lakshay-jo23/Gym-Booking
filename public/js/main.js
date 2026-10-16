// Boots the app: client-side routing (hash based, so it works on any static host),
// route protection, and the navigation bar.
import { auth, setUnauthorizedHandler } from './api.js';
import { h } from './ui.js';
import { loginView, registerView } from './views/auth.js';
import { sessionsView } from './views/sessions.js';
import { bookingsView } from './views/bookings.js';
import { adminView } from './views/admin.js';

// access: 'public' (logged-out only) | 'user' (anyone logged in) | 'member' | 'admin'
const routes = {
  '/login': { title: 'Log in', access: 'public', view: loginView },
  '/register': { title: 'Register', access: 'public', view: registerView },
  '/sessions': { title: 'Sessions', access: 'user', view: sessionsView },
  '/bookings': { title: 'My bookings', access: 'member', view: bookingsView },
  '/admin': { title: 'Admin', access: 'admin', view: adminView },
};

const $main = document.getElementById('main');
const $nav = document.getElementById('nav');
let cleanup = null; // each view may return a function that stops its timers/listeners
let notice = null;  // one-off message to show on the next page
let firstRender = true; // don't steal focus on the very first load (keeps the skip link reachable)

const ctx = {
  get user() { return auth.user; },
  navigate,
  takeNotice() { const n = notice; notice = null; return n; },
};

function navigate(path) {
  if (location.hash === '#' + path) render();
  else location.hash = '#' + path; // triggers 'hashchange' -> render()
}

function logout(message) {
  auth.clear();
  if (message) notice = message;
  navigate('/login');
}
setUnauthorizedHandler(() => logout({ kind: 'error', text: 'Your session has expired. Please log in again.' }));

function renderNav(user, path) {
  const link = (to, text) => h('a', { href: '#' + to, 'aria-current': path === to ? 'page' : null }, text);
  $nav.replaceChildren(...(user
    ? [
        link('/sessions', 'Sessions'),
        user.role === 'member' && link('/bookings', 'My bookings'),
        user.role === 'admin' && link('/admin', 'Admin'),
        h('span', { class: 'who' }, user.name),
        h('button', { class: 'btn', type: 'button', onclick: () => logout() }, 'Log out'),
      ]
    : [link('/login', 'Log in'), link('/register', 'Register')]).filter(Boolean));
}

function render() {
  if (cleanup) { cleanup(); cleanup = null; }
  const user = auth.token ? auth.user : null;
  let path = location.hash.slice(1);
  if (!path || path === '/') path = user ? '/sessions' : '/login';

  const route = routes[path];
  renderNav(user, path);

  if (!route) {
    $main.replaceChildren(h('h1', { tabindex: '-1' }, 'Page not found'), h('p', null, h('a', { href: '#/' }, 'Go to the start page')));
    document.title = 'Not found · Gym Booking';
    return;
  }

  // ---- route protection (the server enforces the same rules; this is just the UX) ----
  if (route.access === 'public' && user) return navigate('/sessions');
  if (route.access !== 'public' && !user) return navigate('/login');
  if (route.access === 'admin' && user.role !== 'admin') {
    notice = { kind: 'error', text: 'That page is for admins only.' };
    return navigate('/sessions');
  }
  if (route.access === 'member' && user.role !== 'member') return navigate('/sessions');

  $main.replaceChildren();
  cleanup = route.view($main, ctx) || null;
  document.title = `${route.title} · Gym Booking`;
  // On later navigations, move focus to the new page's heading so keyboard and screen-reader users know the page changed
  const heading = $main.querySelector('h1');
  if (heading) { heading.tabIndex = -1; if (!firstRender) heading.focus(); }
  firstRender = false;
}

// The skip link must not change the hash (that would trigger the router)
document.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); $main.focus(); });

window.addEventListener('hashchange', render);
render();
