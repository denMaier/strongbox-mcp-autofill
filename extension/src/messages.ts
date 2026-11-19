// Messages between the popup, the pop-in, the background and the content scripts.

import type { Database, ErrorKind, Match } from './protocol.ts';

// How long the popup and the pop-in show "Filled" before they close.
export const doneMs = 600;

// The login list's requests, from the popup or the pop-in. The popup names its tab;
// the pop-in's tab and frame come from its token. "cancel" drops a pending unlock or
// fill, so a late approval in Strongbox fills nothing.
export type ViewRequest =
  | { type: 'open'; tabId?: number }
  | { type: 'unlock'; database_id: string }
  | { type: 'fill'; database_id: string; credential_id: string }
  | { type: 'cancel' };

// Pop-in -> background, over a runtime port named "menu". "hello" comes first and
// carries the token; "size" and "close" are passed on to the frame's content script,
// "ping" keeps the background awake until the user clicks.
export type MenuRequest =
  | ViewRequest
  | { type: 'hello'; token: string }
  | { type: 'size'; height: number }
  | { type: 'close' }
  | { type: 'ping' };

// The entry last filled in a tab, for the next step of the same site's login. Only its
// IDs are kept, not its title or username.
export interface Recent {
  database_id: string;
  credential_id: string;
}

// Background -> popup or pop-in. Metadata only, never secret values. "recent" tells a
// pop-in after its hello, before any request to Strongbox, that this tab has a recent
// entry for its site; "view" names that entry if the search found it.
export type ViewMessage =
  | { type: 'view'; site: string; databases: Database[]; matches: Match[]; recent?: Recent }
  | { type: 'recent' }
  | { type: 'filled' }
  | { type: 'error'; kind: ErrorKind };

// Background -> content scripts. The pop-in messages name the token of the pop-in they are for.
// "fill" holds no values: the frame then opens a runtime port named "fill" to fetch them.
export type ContentRequest =
  | { type: 'analyse' }
  | { type: 'fill'; expectedOrigin: string }
  | { type: 'popin-size'; token: string; height: number }
  | { type: 'popin-close'; token: string };

// Pop-in content script -> background.
export type TokenRequest = { type: 'menu-token' };

export type FillResult = 'filled' | 'wrong_origin' | 'no_fields';
