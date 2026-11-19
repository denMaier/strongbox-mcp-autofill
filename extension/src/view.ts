// The login list, shared by the toolbar popup and the pop-in. It shows titles,
// usernames and vaults, never secret values.

import { doneMs, type Recent, type ViewMessage, type ViewRequest } from './messages.ts';
import type { Database, ErrorKind, Match } from './protocol.ts';

export const messages: Record<ErrorKind, string> = {
  not_paired:
    'Strongbox has not approved this browser yet. In Strongbox, open Settings → Extensions → Paired MCP Hosts and approve "Strongbox Browser Bridge".',
  disabled: 'MCP access is turned off in Strongbox, or for this vault.',
  locked: 'Strongbox needs this vault unlocked or access approved. Try again.',
  denied: 'Strongbox declined the request. Nothing was filled.',
  unavailable: 'Strongbox is not reachable. Make sure it is running.',
  invalid: 'The request was refused. Nothing was filled.',
  timeout: 'This took too long. Try again.',
  no_bridge: 'The Strongbox Browser Bridge is not installed for this browser. Run bridge/install.sh from this project.',
  bridge_failed: 'The bridge stopped or answered unexpectedly. Nothing was filled.',
  disconnected: 'Connection lost. Restart your browser.',
  no_page: 'This page cannot be filled. Only http and https pages are supported.',
  no_form: 'No login form found on this page.',
  nothing_to_fill: 'This entry has nothing that fits the fields on this page.',
  origin_changed: 'The page changed before filling, so nothing was filled.',
  failed: 'Something went wrong. Nothing was filled.',
};

export interface View {
  say(text: string, state?: State): void;
  // An error that "Try again" can't fix, such as a lost connection to the background.
  fail(kind: ErrorKind): void;
  receive(message: ViewMessage): void;
}

type State = 'busy' | 'error' | 'done';

export interface ViewOptions {
  // Act without asking when the choice is clear: unlock the only vault if it is locked,
  // then fill the entry filled in this tab's last step, or the only match. The pop-in
  // sets this; its click is the request to fill.
  autoFill: boolean;
  filled(): void;
  retry(): void;
  cancel(): void;
}

// A fill that takes longer than this is most likely waiting for an approval in Strongbox.
const promptAfterMs = 1500;

// Uses the #site, #message, #matches, #vaults, #retry and #cancel elements of the page.
export function createView(send: (request: ViewRequest) => void, options: ViewOptions): View {
  const siteElement = document.getElementById('site')!;
  const messageElement = document.getElementById('message')!;
  const matchList = document.getElementById('matches')!;
  const vaultList = document.getElementById('vaults')!;
  const retry = document.getElementById('retry')!;
  const cancel = document.getElementById('cancel')!;
  let waiting: ReturnType<typeof setTimeout> | undefined;
  // Unlock by itself once per attempt, so a vault that stays locked shows its button.
  let autoUnlocked = false;

  function say(text: string, state?: State): void {
    clearTimeout(waiting);
    messageElement.textContent = text;
    for (const name of ['busy', 'error', 'done'] as const) messageElement.classList.toggle(name, state === name);
    cancel.hidden = state !== 'busy';
  }

  function setBusy(busy: boolean): void {
    for (const button of document.querySelectorAll<HTMLButtonElement>('ul button')) button.disabled = busy;
  }

  // Strongbox's prompt opens in its own window, which is easy to miss behind the browser.
  function wait(text: string): void {
    setBusy(true);
    say(text, 'busy');
    waiting = setTimeout(() => {
      messageElement.textContent = 'Waiting for Strongbox. Approve with Touch ID or in the Strongbox window.';
    }, promptAfterMs);
  }

  function item(...children: Node[]): HTMLLIElement {
    const li = document.createElement('li');
    li.append(...children);
    return li;
  }

  function span(className: string, text: string): HTMLSpanElement {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    return element;
  }

  function fill(match: Match): void {
    wait('Filling…');
    send({ type: 'fill', database_id: match.database_id, credential_id: match.credential_id });
  }

  function showMatch(match: Match, isRecent: boolean): HTMLLIElement {
    const button = document.createElement('button');
    button.className = 'entry';
    const title = match.title || '(untitled)';
    const detail = [match.username, match.database_name].filter(Boolean).join(' · ');
    const titleElement = span('title', title);
    if (isRecent) titleElement.append(span('tag', 'Last used'));
    button.append(titleElement, span('detail', detail));
    // Both lines may be cut off; the tooltip has them in full.
    button.title = [title, detail].filter(Boolean).join('\n');
    button.addEventListener('click', () => fill(match));
    return item(button);
  }

  function showLockedVault(database: Database): HTMLLIElement {
    const row = document.createElement('div');
    row.className = 'vault';
    const button = document.createElement('button');
    button.textContent = 'Unlock';
    button.setAttribute('aria-label', `Unlock ${database.name}`);
    button.addEventListener('click', () => unlock(database));
    row.append(span('detail', `${database.name} is locked`), button);
    return item(row);
  }

  function unlock(database: Database): void {
    wait('Unlocking…');
    send({ type: 'unlock', database_id: database.id });
  }

  function isMatch(match: Match, recent: Recent | undefined): boolean {
    return match.database_id === recent?.database_id && match.credential_id === recent.credential_id;
  }

  function show(site: string, databases: Database[], matches: Match[], recent: Recent | undefined): void {
    retry.hidden = true;
    siteElement.textContent = site;
    siteElement.hidden = false;
    if (options.autoFill && !autoUnlocked && databases.length === 1 && databases[0].locked) {
      autoUnlocked = true;
      matchList.replaceChildren();
      vaultList.replaceChildren();
      unlock(databases[0]);
      return;
    }
    const recentMatch = matches.find(match => isMatch(match, recent));
    const clear = recentMatch ?? (matches.length === 1 ? matches[0] : undefined);
    if (options.autoFill && clear) {
      matchList.replaceChildren();
      vaultList.replaceChildren();
      fill(clear);
      return;
    }
    // The last used entry first, so Enter fills it.
    const ordered = recentMatch ? [recentMatch, ...matches.filter(match => match !== recentMatch)] : matches;
    matchList.replaceChildren(...ordered.map(match => showMatch(match, match === recentMatch)));
    vaultList.replaceChildren(...databases.filter(database => database.locked).map(showLockedVault));
    if (databases.length === 0) say('No vaults are available to MCP. Turn on MCP access for a vault in Strongbox.');
    else if (matches.length === 0 && databases.some(database => database.locked)) say('No logins found in unlocked vaults.');
    else if (matches.length === 0) say("No logins found. Add one in Strongbox with this site's address.");
    else say('');
    // Enter fills the first login, as in the browser's own login menus.
    document.querySelector<HTMLButtonElement>('ul button')?.focus();
  }

  function fail(kind: ErrorKind, canRetry = false): void {
    setBusy(true);
    say(messages[kind] ?? messages.failed, 'error');
    retry.hidden = !canRetry;
    if (canRetry) retry.focus();
  }

  // Arrow keys move between the buttons, as in a menu.
  document.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(button => !button.disabled && button.offsetParent);
    if (buttons.length === 0) return;
    event.preventDefault();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    buttons[at < 0 ? 0 : (at + step + buttons.length) % buttons.length].focus();
  });

  retry.addEventListener('click', () => {
    retry.hidden = true;
    autoUnlocked = false;
    options.retry();
  });

  cancel.addEventListener('click', () => {
    clearTimeout(waiting);
    send({ type: 'cancel' });
    options.cancel();
  });

  return {
    say,
    fail,
    receive(message) {
      if (message.type === 'view') show(message.site, message.databases, message.matches, message.recent);
      else if (message.type === 'filled') {
        say('Filled', 'done');
        setTimeout(options.filled, doneMs);
      }
      // Every error ends the session, so a new one is needed.
      else if (message.type === 'error') fail(message.kind, true);
    },
  };
}
