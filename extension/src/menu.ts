// The pop-in under a login field (docs/DESIGN.md, "Pop-in"). It runs in an iframe the
// page can't read. Focus is not a user action, so it asks Strongbox only after a click
// on its button. That click is the request to fill: with one clear choice it fills
// straight away, otherwise it shows the list.

import type { MenuRequest, ViewMessage } from './messages.ts';
import { createView } from './view.ts';

const keepAliveMs = 20 * 1000;

const showButton = document.getElementById('show')!;
const showTitle = showButton.querySelector('.title')!;
const list = document.getElementById('list')!;

const port = chrome.runtime.connect({ name: 'menu' });
const send = (request: MenuRequest) => {
  try {
    port.postMessage(request);
  } catch {
    // The port is gone; onDisconnect shows why.
  }
};
const start = () => {
  view.say('Asking Strongbox…', 'busy');
  send({ type: 'open' });
};
// After a fill the content script removes the pop-in.
const view = createView(send, { autoFill: true, filled: () => {}, retry: start, cancel: () => send({ type: 'close' }) });

send({ type: 'hello', token: location.hash.slice(1) });
port.onMessage.addListener((message: ViewMessage) => {
  // The next step of a login just filled in this tab: the click fills that entry again.
  if (message.type === 'recent') {
    showTitle.textContent = 'Continue with the same login';
    return;
  }
  view.receive(message);
});

// The background ends the port for a bad token, or when it stops; this pop-in can't recover.
const keepAlive = setInterval(() => send({ type: 'ping' }), keepAliveMs);
port.onDisconnect.addListener(() => {
  clearInterval(keepAlive);
  showButton.hidden = true;
  list.hidden = false;
  view.fail('disconnected');
});

showButton.addEventListener('click', () => {
  showButton.hidden = true;
  list.hidden = false;
  start();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') send({ type: 'close' });
});

// The content script focuses the iframe on ArrowDown in the field.
window.addEventListener('focus', () => {
  if (document.activeElement === document.body) document.querySelector<HTMLButtonElement>('button:not([hidden], :disabled)')?.focus();
});

// The content script sizes the iframe to fit.
new ResizeObserver(() => send({ type: 'size', height: Math.ceil(document.documentElement.getBoundingClientRect().height) })).observe(
  document.body,
);
