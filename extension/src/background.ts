// The fill flow (docs/DESIGN.md, "Fill flow"). The state is the one open session and,
// per tab, the IDs of the entry filled last; secret values live only inside fill().

import { Bridge, lifetimeMs } from './bridge.ts';
import type { FillValues } from './content/AutoFiller.ts';
import {
  doneMs,
  type ContentRequest,
  type FillResult,
  type MenuRequest,
  type Recent,
  type TokenRequest,
  type ViewMessage,
  type ViewRequest,
} from './messages.ts';
import { fieldsToReveal, isFromFrame, pageOrigin, parseReport, pickFrame, searchUrl, type Frame, type Target } from './plan.ts';
import {
  FillError,
  parseDatabases,
  parseMatches,
  parseOk,
  parseValues,
  type Database,
  type ErrorKind,
  type Match,
  type RevealField,
  type Values,
} from './protocol.ts';
import { bindFrame, isMenuFor, Tokens, type Binding } from './tokens.ts';

const host = 'io.github.denmaier.strongbox_bridge';
// How long the entry filled last is offered for the next step of the same login.
const recentMs = 3 * 60 * 1000;

interface Session {
  bridge: Bridge;
  tabId: number;
  tabOrigin: string;
  // The frame to fill, chosen when the session opens; search uses its URL and origin.
  target?: Target;
  origin: string;
  url: string;
  databases: Database[];
  matches: Match[];
  // The popup or pop-in showing this session, while it is open.
  view?: chrome.runtime.Port;
  busy: boolean;
}

// Values waiting for the one frame they were revealed for.
interface Delivery {
  tabId: number;
  frame: Frame;
  values: FillValues;
}

let session: Session | undefined;
let delivery: Delivery | undefined;
const tokens = new Tokens();

// Kept in session storage, which lives in memory and survives the worker stopping
// between the steps of a login. Only extension pages can read it, not content scripts.
interface Remembered extends Recent {
  origin: string;
  at: number;
}

const recentKey = (tabId: number) => `recent:${tabId}`;

async function remember(current: Session, match: Match): Promise<void> {
  const { database_id, credential_id } = match;
  const value: Remembered = { database_id, credential_id, origin: current.origin, at: Date.now() };
  await chrome.storage.session.set({ [recentKey(current.tabId)]: value }).catch(() => {});
}

async function recall(tabId: number, origin: string): Promise<Recent | undefined> {
  const stored = await chrome.storage.session.get(recentKey(tabId)).catch(() => ({}));
  const value = (stored as Record<string, Remembered | undefined>)[recentKey(tabId)];
  if (!value || value.origin !== origin || Date.now() - value.at > recentMs) return undefined;
  const { database_id, credential_id } = value;
  return { database_id, credential_id };
}

chrome.tabs.onRemoved.addListener(tabId => void chrome.storage.session.remove(recentKey(tabId)).catch(() => {}));

function kindOf(error: unknown): ErrorKind {
  return error instanceof FillError ? error.kind : 'failed';
}

// Read inside onDisconnect: a missing or forbidden host means the bridge is not installed for us.
function disconnectKind(): ErrorKind {
  const message = chrome.runtime.lastError?.message ?? '';
  return /not found|forbidden/i.test(message) ? 'no_bridge' : 'bridge_failed';
}

function post(port: chrome.runtime.Port | undefined, message: ViewMessage): void {
  try {
    port?.postMessage(message);
  } catch {
    // The popup or pop-in closed.
  }
}

// One session per user action; a new action ends the previous one. The pop-in
// pins the frame its token is bound to; otherwise the frame is picked here.
async function open(tabId: number, pinned?: Binding): Promise<Session> {
  session?.bridge.close();
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const tabOrigin = pageOrigin(tab?.url);
  if (!tab?.url || !tabOrigin) throw new FillError('no_page');
  const target = pinned ? await analysePinned(pinned) : await findTarget(tabId);
  const url = pinned?.url ?? target?.url ?? tab.url;

  const port = chrome.runtime.connectNative(host);
  const opened: Session = {
    tabId,
    tabOrigin,
    target,
    origin: pageOrigin(url)!,
    url,
    databases: [],
    matches: [],
    busy: false,
    bridge: new Bridge(port, disconnectKind, kind => {
      if (session === opened) session = undefined;
      // Errors during a step reach the view through its handler.
      if (kind && !opened.busy) post(opened.view, { type: 'error', kind });
    }),
  };
  session = opened;
  return opened;
}

// Runs one step. If the view closed meanwhile (a Strongbox prompt takes focus), the session ends after it.
async function step<T>(current: Session, work: () => Promise<T>): Promise<T> {
  current.busy = true;
  try {
    return await work();
  } catch (error) {
    current.bridge.close(kindOf(error));
    throw error;
  } finally {
    current.busy = false;
    if (!current.view) current.bridge.close();
  }
}

async function refresh(current: Session): Promise<void> {
  current.databases = parseDatabases(await current.bridge.request({ op: 'status' }));
  current.matches = current.databases.some(database => !database.locked)
    ? parseMatches(await current.bridge.request({ op: 'search', url: searchUrl(current.url) }))
    : [];
}

// Messages to a frame name only its document: that is the stricter target, and WebKit
// refuses frameId and documentId together.
async function analyse(tabId: number, frame: Omit<Frame, 'report'>): Promise<Frame> {
  const request: ContentRequest = { type: 'analyse' };
  const report = await chrome.tabs
    .sendMessage(tabId, request, { documentId: frame.documentId })
    .then(parseReport, () => undefined);
  return { frameId: frame.frameId, documentId: frame.documentId, url: frame.url, report };
}

// Injects the content script into every frame and picks the one to fill.
async function findTarget(tabId: number): Promise<Target | undefined> {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  } catch {
    throw new FillError('no_page');
  }
  const all = (await chrome.webNavigation.getAllFrames({ tabId })) ?? [];
  // Without a documentId, a message would reach every frame in the tab.
  const usable = all.filter(frame => frame.documentId && pageOrigin(frame.url));
  const frames = await Promise.all(usable.map(frame => analyse(tabId, frame)));
  return pickFrame(frames);
}

// Injects the content script into the pop-in's frame only, and checks that frame still has a field.
async function analysePinned(pinned: Binding): Promise<Target | undefined> {
  try {
    await chrome.scripting.executeScript({ target: { tabId: pinned.tabId, documentIds: [pinned.documentId] }, files: ['content.js'] });
  } catch {
    throw new FillError('origin_changed');
  }
  return pickFrame([await analyse(pinned.tabId, pinned)]);
}

// The browser's view of the tab and the frame must still match what was analysed.
async function checkOrigin(current: Session, frame: Frame): Promise<void> {
  const tab = await chrome.tabs.get(current.tabId).catch(() => undefined);
  const now = await chrome.webNavigation.getFrame({ tabId: current.tabId, frameId: frame.frameId }).catch(() => null);
  if (
    pageOrigin(tab?.url) !== current.tabOrigin ||
    !now ||
    now.documentId !== frame.documentId ||
    pageOrigin(now.url) !== current.origin
  ) {
    throw new FillError('origin_changed');
  }
}

// tabs.sendMessage can reach more than its target: Search also hands it to the extension's
// own pages framed in the tab. So the message holds no values. The frame fetches them over
// a port, which the browser attributes to its sender (serveFill).
async function deliver(next: Delivery, expectedOrigin: string): Promise<FillResult | undefined> {
  delivery = next;
  const request: ContentRequest = { type: 'fill', expectedOrigin };
  try {
    return await chrome.tabs.sendMessage(next.tabId, request, { documentId: next.frame.documentId });
  } catch {
    return undefined;
  } finally {
    if (delivery === next) delivery = undefined;
  }
}

// The values go out once, and only to the frame they were revealed for.
function serveFill(port: chrome.runtime.Port): void {
  const waiting = delivery;
  if (!waiting || !isFromFrame(waiting.tabId, waiting.frame, port.sender)) return port.disconnect();
  delivery = undefined;
  port.postMessage(waiting.values);
}

function findMatch(current: Session, databaseId: string, credentialId: string): Match {
  const match = current.matches.find(item => item.database_id === databaseId && item.credential_id === credentialId);
  if (!match) throw new FillError('invalid');
  return match;
}

// Strongbox can list and search a vault yet refuse a reveal until unlock_database has run,
// as in timed mode for a vault the user unlocked. The user just asked for this fill, so
// ask once: Strongbox prompts, and the reveal then needs a fresh search.
async function reveal(current: Session, frame: Frame, match: Match, fields: RevealField[]): Promise<Values> {
  const { database_id, credential_id } = match;
  const request = () => current.bridge.request({ op: 'reveal', database_id, credential_id, fields });
  try {
    return parseValues(await request(), fields);
  } catch (error) {
    if (kindOf(error) !== 'locked') throw error;
  }
  parseOk(await current.bridge.request({ op: 'unlock', database_id }));
  await refresh(current);
  findMatch(current, database_id, credential_id);
  await checkOrigin(current, frame);
  return parseValues(await request(), fields);
}

async function fill(current: Session, match: Match): Promise<void> {
  const { tabId, origin, target } = current;
  if (!target) throw new FillError('no_form');
  // Ask the same document again: a two-step login may have changed its fields since.
  const { report } = await analyse(tabId, target);
  if (!report) throw new FillError('origin_changed');
  const frame = { ...target, report };

  const fields = fieldsToReveal(frame.report, match.available_fields);
  const username = frame.report.hasLogin && match.username ? match.username : undefined;
  if (fields.length === 0 && !username) throw new FillError('nothing_to_fill');

  await checkOrigin(current, frame);
  let values: Values = {};
  if (fields.length > 0) values = await reveal(current, frame, match, fields);
  await checkOrigin(current, frame);
  // Cancelled while Strongbox was asking.
  if (current.bridge.closed) throw new FillError('failed');

  const next: Delivery = { tabId, frame, values: { username, ...values } };
  values = {};
  const result = await deliver(next, origin);
  if (result === 'wrong_origin') throw new FillError('origin_changed');
  if (result !== 'filled') throw new FillError('no_form');
}

async function fillChosen(current: Session, databaseId: string, credentialId: string): Promise<void> {
  const match = findMatch(current, databaseId, credentialId);
  await fill(current, match);
  current.bridge.close();
  await remember(current, match);
}

async function viewOf(current: Session): Promise<ViewMessage> {
  const { databases, matches } = current;
  return { type: 'view', site: new URL(current.origin).host, databases, matches, recent: await recall(current.tabId, current.origin) };
}

// The flow shared by the popup and the pop-in: open on the user's request, unlock, fill.
// Returns the handler for the view's requests.
function serve(
  port: chrome.runtime.Port,
  start: (request: Extract<ViewRequest, { type: 'open' }>) => Promise<Session>,
  filled: () => void,
): (message: ViewRequest) => Promise<void> {
  let current: Session | undefined;
  let cancelled = false;

  port.onDisconnect.addListener(() => {
    if (!current) return;
    current.view = undefined;
    if (!current.busy) current.bridge.close();
  });

  return async message => {
    try {
      if (message.type === 'cancel') {
        cancelled = true;
        current?.bridge.close();
        return;
      }
      if (message.type === 'open') {
        cancelled = false;
        current = await start(message);
        current.view = port;
        await step(current, () => refresh(current!));
        post(port, await viewOf(current));
        return;
      }
      if (!current || current.bridge.closed) throw new FillError('timeout');
      const active = current;
      if (message.type === 'unlock') {
        if (!active.databases.some(database => database.id === message.database_id)) throw new FillError('invalid');
        await step(active, async () => {
          parseOk(await active.bridge.request({ op: 'unlock', database_id: message.database_id }));
          await refresh(active);
        });
        post(port, await viewOf(active));
      } else if (message.type === 'fill') {
        await step(active, () => fillChosen(active, message.database_id, message.credential_id));
        post(port, { type: 'filled' });
        filled();
      }
    } catch (error) {
      if (!cancelled) post(port, { type: 'error', kind: kindOf(error) });
    }
  };
}

function servePopup(port: chrome.runtime.Port): void {
  const handle = serve(
    port,
    async ({ tabId }) => {
      if (tabId === undefined) throw new FillError('no_page');
      void chrome.action.setBadgeText({ tabId, text: '' });
      return open(tabId);
    },
    () => {},
  );
  port.onMessage.addListener(handle);
}

// Tells the pop-in's content script to resize or remove it.
function toFrame(binding: Binding, request: ContentRequest): void {
  chrome.tabs
    .sendMessage(binding.tabId, request, { documentId: binding.documentId })
    .catch(() => {});
}

// The token is used up first, so a second try with it fails even if these checks pass.
async function acceptMenu(port: chrome.runtime.Port, token: unknown): Promise<Binding | undefined> {
  const binding = tokens.use(token);
  const sender = port.sender;
  if (!binding || sender?.tab?.id === undefined || sender.frameId === undefined) return undefined;
  return isMenuFor(binding, sender.tab.id, sender.frameId, sender.url) ? binding : undefined;
}

// A pop-in's port. It must say hello with a live token first; the session then fills
// only the token's frame. Without a user request for two minutes the pop-in closes,
// which also stops its pings keeping the background awake.
function serveMenu(port: chrome.runtime.Port): void {
  let accepted: Promise<Binding | undefined> | undefined;
  let token = '';
  let idle: ReturnType<typeof setTimeout> | undefined;
  const close = (binding: Binding) => toFrame(binding, { type: 'popin-close', token });
  const handle = serve(
    port,
    async () => {
      const binding = await accepted;
      if (!binding) throw new FillError('invalid');
      return open(binding.tabId, binding);
    },
    // Long enough for the pop-in to show "Filled".
    () => void accepted?.then(binding => binding && setTimeout(() => close(binding), doneMs)),
  );

  port.onDisconnect.addListener(() => clearTimeout(idle));
  port.onMessage.addListener(async (message: MenuRequest) => {
    if (!accepted) {
      if (message.type !== 'hello') return port.disconnect();
      token = message.token;
      accepted = acceptMenu(port, message.token);
    }
    const binding = await accepted;
    // Say why instead of just closing, so a refused pop-in can be told from other failures.
    if (!binding) return post(port, { type: 'error', kind: 'invalid' });
    if (message.type === 'hello') {
      const origin = pageOrigin(binding.url);
      const recent = origin && (await recall(binding.tabId, origin));
      if (recent) post(port, { type: 'recent' });
    }
    if (message.type === 'hello' || (message.type !== 'ping' && message.type !== 'size')) {
      clearTimeout(idle);
      idle = setTimeout(() => close(binding), lifetimeMs);
    }
    if (message.type === 'size') toFrame(binding, { type: 'popin-size', token, height: message.height });
    else if (message.type === 'close') close(binding);
    else if (message.type === 'open' || message.type === 'unlock' || message.type === 'fill' || message.type === 'cancel') await handle(message);
  });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.sender?.id !== chrome.runtime.id) return port.disconnect();
  if (port.name === 'popup' && port.sender.url === chrome.runtime.getURL('popup.html')) return servePopup(port);
  if (port.name === 'menu') return serveMenu(port);
  if (port.name === 'fill') return serveFill(port);
  port.disconnect();
});

// A pop-in token for the content script that asks, bound to its tab, frame and
// document, and to the frame's URL as the browser reports it.
async function issueToken(sender: chrome.runtime.MessageSender): Promise<string | undefined> {
  const { tab, frameId, documentId } = sender;
  if (sender.id !== chrome.runtime.id || tab?.id === undefined || frameId === undefined || !documentId) return undefined;
  const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId }).catch(() => null);
  const binding = bindFrame(tab.id, frameId, documentId, frame);
  return binding && tokens.issue(binding);
}

chrome.runtime.onMessage.addListener((message: TokenRequest, sender, sendResponse) => {
  if (message?.type !== 'menu-token') return false;
  issueToken(sender).then(sendResponse, () => sendResponse(undefined));
  return true;
});

// The shortcut fills a single match. Anything else opens the popup, which starts again and shows why.
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'fill-login' || tab?.id === undefined) return;
  const tabId = tab.id;
  try {
    const current = await open(tabId);
    const filled = await step(current, async () => {
      await refresh(current);
      if (current.matches.length !== 1) return false;
      await fillChosen(current, current.matches[0].database_id, current.matches[0].credential_id);
      return true;
    });
    if (filled) return;
  } catch {
    // Shown by the popup.
  }
  session?.bridge.close();
  try {
    await chrome.action.openPopup({ windowId: tab.windowId });
  } catch {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#0f766e' });
    await chrome.action.setBadgeText({ tabId, text: '?' });
  }
});
