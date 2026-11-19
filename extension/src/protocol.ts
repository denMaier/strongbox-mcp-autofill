// The bridge protocol (docs/DESIGN.md, "Bridge protocol"). Every response is
// checked here; anything unexpected becomes an error, so nothing is filled.

export const bridgeErrors = ['not_paired', 'disabled', 'locked', 'denied', 'unavailable', 'invalid', 'timeout'] as const;

export type ErrorKind =
  | (typeof bridgeErrors)[number]
  | 'no_bridge' // the native host is not installed or not allowed for this extension
  | 'bridge_failed' // the bridge exited or answered outside the protocol
  | 'disconnected' // the pop-in lost its connection to the background
  | 'no_page' // the tab is not an http(s) page we may access
  | 'no_form' // no login or one-time-code field in a frame of the tab's origin
  | 'nothing_to_fill' // the entry has nothing that fits the fields found
  | 'origin_changed' // the tab or frame navigated during the fill
  | 'failed'; // anything else

export class FillError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind) {
    super(kind);
    this.kind = kind;
  }
}

export type RevealField = 'password' | 'totp';

export interface Database {
  id: string;
  name: string;
  locked: boolean;
}

export interface Match {
  database_id: string;
  database_name: string;
  credential_id: string;
  title: string;
  username: string;
  available_fields: string[];
}

export type Values = Partial<Record<RevealField, string>>;

type Reply = Record<string, unknown>;

function fail(): never {
  throw new FillError('bridge_failed');
}

function isObject(value: unknown): value is Reply {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : fail();
}

function list(value: unknown, max = Infinity): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : fail();
}

export function parseDatabases(reply: Reply): Database[] {
  return list(reply.databases).map(item => {
    if (!isObject(item) || typeof item.locked !== 'boolean') fail();
    return { id: string(item.id), name: string(item.name), locked: item.locked };
  });
}

export function parseMatches(reply: Reply): Match[] {
  return list(reply.matches, 20).map(item => {
    if (!isObject(item)) fail();
    return {
      database_id: string(item.database_id),
      database_name: string(item.database_name),
      credential_id: string(item.credential_id),
      title: string(item.title),
      username: string(item.username),
      available_fields: list(item.available_fields).map(string),
    };
  });
}

export function parseOk(reply: Reply): void {
  if (reply.ok !== true) fail();
}

// The values must hold exactly the fields that were asked for.
export function parseValues(reply: Reply, fields: RevealField[]): Values {
  const values = reply.values;
  if (!isObject(values)) fail();
  const keys = Object.keys(values);
  if (keys.length !== fields.length || !fields.every(field => keys.includes(field))) fail();
  const result: Values = {};
  for (const field of fields) result[field] = string(values[field]);
  return result;
}

export function isBridgeError(kind: unknown): kind is (typeof bridgeErrors)[number] {
  return (bridgeErrors as readonly unknown[]).includes(kind);
}
