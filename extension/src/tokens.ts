// One-time tokens for the pop-in (docs/DESIGN.md, "Pop-in"). The content script
// gets one when a login field gets focus and puts it in the pop-in's URL; the
// pop-in presents it, and the background then fills only the frame it is bound to.
// Pure apart from the random source, so tests can pass a clock.

import { pageOrigin } from './plan.ts';

export const tokenLifetimeMs = 2 * 60 * 1000;

// Enough for every frame of a few tabs; a page that keeps focusing fields only pushes out older tokens.
const maxTokens = 16;

// The frame a token was issued to, as the browser reports it.
export interface Binding {
  tabId: number;
  frameId: number;
  documentId: string;
  url: string;
}

interface Issued {
  binding: Binding;
  expires: number;
}

export class Tokens {
  #issued = new Map<string, Issued>();
  #random: () => string;

  constructor(random: () => string = () => crypto.randomUUID()) {
    this.#random = random;
  }

  issue(binding: Binding, now = Date.now()): string {
    for (const [token, { binding: other, expires }] of this.#issued) {
      // One pop-in per frame: a new token replaces that frame's older one.
      if (expires <= now || (other.tabId === binding.tabId && other.frameId === binding.frameId)) this.#issued.delete(token);
    }
    while (this.#issued.size >= maxTokens) this.#issued.delete(this.#issued.keys().next().value!);
    const token = this.#random();
    this.#issued.set(token, { binding, expires: now + tokenLifetimeMs });
    return token;
  }

  // A token works once, even if the checks after it fail.
  use(token: unknown, now = Date.now()): Binding | undefined {
    if (typeof token !== 'string') return undefined;
    const issued = this.#issued.get(token);
    this.#issued.delete(token);
    return issued && issued.expires > now ? issued.binding : undefined;
  }
}

// What the browser says about the frame that asked for a token. The URL comes
// from webNavigation, never from the page.
export interface FrameInfo {
  documentId?: string;
  url?: string;
}

// The binding for a content script's request, if the frame is still the document that sent it.
export function bindFrame(tabId: number, frameId: number, documentId: string, frame: FrameInfo | null): Binding | undefined {
  if (!frame || frame.documentId !== documentId || !pageOrigin(frame.url)) return undefined;
  return { tabId, frameId, documentId, url: frame.url! };
}

// The pop-in must be our menu.html in the token's tab. Its parent frame isn't checked:
// webNavigation doesn't reliably report extension frames, and the single-use token,
// handed only to our script in the bound frame, is what binds the menu to that frame.
export function isMenuFor(binding: Binding, tabId: number | undefined, frameId: number | undefined, url: string | undefined): boolean {
  let path: string | undefined;
  try {
    const parsed = new URL(url ?? '');
    path = parsed.protocol === 'chrome-extension:' ? parsed.pathname : undefined;
  } catch {
    return false;
  }
  return path === '/menu.html' && tabId === binding.tabId && frameId !== undefined && frameId !== binding.frameId;
}
