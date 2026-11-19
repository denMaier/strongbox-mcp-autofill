// Runs in every http(s) frame (docs/DESIGN.md, "Pop-in"). It only watches focus:
// when a username, password or one-time-code field gets focus, it shows the pop-in
// (menu.html) under it. It reads no values, sends nothing on load, and sends nothing
// to Strongbox; the pop-in asks Strongbox only when the user clicks in it.

import type { ContentRequest, TokenRequest } from '../messages.ts';
import { PageAnalyser } from './PageAnalyser.ts';
import { placePopin } from './position.ts';

// As wide as the field, within limits, like the browser's own login menus.
const minWidth = 260;
const maxWidth = 360;
const minHeight = 32;
const maxHeight = 320;
const blurGraceMs = 150; // a click into the pop-in blurs the field first

interface Popin {
  field: HTMLInputElement;
  host: HTMLElement;
  frame: HTMLIFrameElement;
  token: string;
  height: number;
}

let popin: Popin | undefined;
let asking: HTMLInputElement | undefined; // waiting for a token for this field
let returning: HTMLInputElement | undefined; // focus given back after closing; don't reopen

function isLoginField(field: HTMLInputElement): boolean {
  return (
    !field.disabled &&
    !field.readOnly &&
    (PageAnalyser.isUsernameInput(field) || PageAnalyser.isPasswordInput(field) || PageAnalyser.isOtpInput(field))
  );
}

// The focused element, looking into open shadow roots.
function focused(): Element | null {
  let element = document.activeElement;
  while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
  return element;
}

function place(): void {
  if (!popin) return;
  if (!popin.field.isConnected) return close();
  const field = popin.field.getBoundingClientRect();
  const width = Math.max(minWidth, Math.min(maxWidth, Math.round(field.width)));
  const { left, top, width: placedWidth, visible } = placePopin(
    field,
    { width, height: popin.height },
    { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight },
  );
  popin.host.style.setProperty('display', visible ? 'block' : 'none', 'important');
  popin.host.style.setProperty('left', `${left}px`, 'important');
  popin.host.style.setProperty('top', `${top}px`, 'important');
  popin.frame.style.width = `${placedWidth}px`;
  popin.frame.style.height = `${popin.height}px`;
}

// With focus inside the pop-in, gives it back to the field, so Esc or a fill leaves the
// keyboard where it was.
function close(): void {
  asking = undefined;
  const closing = popin;
  popin = undefined;
  if (!closing) return;
  const hadFocus = focused() === closing.host;
  closing.host.remove();
  if (hadFocus && closing.field.isConnected) {
    returning = closing.field;
    closing.field.focus({ preventScroll: true });
    returning = undefined;
  }
}

async function open(field: HTMLInputElement): Promise<void> {
  asking = field;
  const request: TokenRequest = { type: 'menu-token' };
  // sendMessage throws outright once the extension has been reloaded.
  const token: unknown = await Promise.resolve()
    .then(() => chrome.runtime.sendMessage(request))
    .catch(() => undefined);
  if (asking !== field || typeof token !== 'string' || focused() !== field) return;
  asking = undefined;

  // A closed shadow root keeps the page's scripts and styles away from the iframe.
  const host = document.createElement('strongbox-mcp-popin');
  host.style.cssText = 'all: initial !important; position: fixed !important; z-index: 2147483647 !important;';
  const frame = document.createElement('iframe');
  frame.title = 'Strongbox logins';
  frame.style.cssText =
    'display: block; border: 1px solid rgba(127, 127, 127, 0.4); border-radius: 8px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2); background: transparent;';
  frame.src = `${chrome.runtime.getURL('menu.html')}#${token}`;
  host.attachShadow({ mode: 'closed' }).append(frame);

  popin = { field, host, frame, token, height: 44 };
  place();
  document.documentElement.append(host);
}

document.addEventListener(
  'focusin',
  event => {
    const target = event.composedPath()[0];
    // Focus moving into the pop-in, or back to its field, keeps it.
    if (popin && (target === popin.field || target === popin.host)) return;
    if (target === returning) return;
    close();
    if (target instanceof HTMLInputElement && isLoginField(target)) void open(target);
  },
  true,
);

document.addEventListener(
  'focusout',
  event => {
    const field = event.composedPath()[0];
    if (field !== popin?.field && field !== asking) return;
    setTimeout(() => {
      const now = focused();
      if (now !== field && (!popin || now !== popin.host)) close();
    }, blurGraceMs);
  },
  true,
);

document.addEventListener(
  'pointerdown',
  event => {
    const target = event.composedPath()[0];
    if (popin) {
      const path = event.composedPath();
      if (!path.includes(popin.host) && !path.includes(popin.field)) close();
      return;
    }
    // A click into a field that already has focus fires no focusin, e.g. one the
    // page focused before this script ran (iCloud).
    if (target instanceof HTMLInputElement && target === focused() && target !== asking && isLoginField(target)) void open(target);
  },
  true,
);

document.addEventListener(
  'keydown',
  event => {
    if (event.key === 'Escape' && (popin || asking)) close();
    // The keyboard way into the pop-in, as in the browser's own login menus.
    if (event.key === 'ArrowDown' && popin && event.composedPath()[0] === popin.field && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      popin.frame.focus();
    }
  },
  true,
);

// A page may have focused a login field before this script ran.
const initial = focused();
if (initial instanceof HTMLInputElement && isLoginField(initial)) void open(initial);

// Scrolling inside any element can move the field, so listen in the capture phase.
document.addEventListener('scroll', () => requestAnimationFrame(place), { capture: true, passive: true });
window.addEventListener('resize', () => requestAnimationFrame(place), { passive: true });

chrome.runtime.onMessage.addListener((request: ContentRequest, sender) => {
  if (sender.id !== chrome.runtime.id || sender.tab || !popin) return false;
  // Only for the pop-in shown now: a late message for an older one is ignored.
  if (request.type === 'popin-close' && request.token === popin.token) close();
  if (request.type === 'popin-size' && request.token === popin.token && Number.isFinite(request.height)) {
    popin.height = Math.max(minHeight, Math.min(maxHeight, request.height));
    place();
  }
  return false;
});
