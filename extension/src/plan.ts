// Pure decisions of the fill flow: which origin, which frame, which fields.

import type { RevealField } from './protocol.ts';

// What the content script found in its frame.
export interface FrameReport {
  hasLogin: boolean; // a username or password field
  hasPassword: boolean;
  hasOtp: boolean; // a one-time-code field
}

export interface Frame {
  frameId: number;
  documentId: string;
  url: string;
  report?: FrameReport;
}

const maxUrlLength = 2048;

// The origin of an http(s) URL, otherwise undefined.
export function pageOrigin(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
  } catch {
    return undefined;
  }
}

// The URL sent to search: without query and fragment, which can carry tokens
// and are not needed to match a login.
export function searchUrl(url: string): string {
  const parsed = new URL(url);
  const withPath = parsed.origin + parsed.pathname;
  return withPath.length <= maxUrlLength ? withPath : parsed.origin + '/';
}

export function parseReport(value: unknown): FrameReport | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { hasLogin, hasPassword, hasOtp } = value as Record<string, unknown>;
  if (typeof hasLogin !== 'boolean' || typeof hasPassword !== 'boolean' || typeof hasOtp !== 'boolean') return undefined;
  return { hasLogin, hasPassword, hasOtp };
}

export type Target = Frame & { report: FrameReport };

// The frame to fill, of any http(s) origin: one with a password field first, then any
// login or one-time-code field, top frame first. Search then uses this frame's own URL,
// so an embedded sign-in frame (iCloud) matches its own site, never the host page's.
export function pickFrame(frames: Frame[]): Target | undefined {
  const candidates = frames
    .filter((frame): frame is Target => pageOrigin(frame.url) !== undefined && frame.report !== undefined)
    .filter(frame => frame.report.hasLogin || frame.report.hasOtp)
    .sort((a, b) => a.frameId - b.frameId);
  return candidates.find(frame => frame.report.hasPassword) ?? candidates[0];
}

export interface FrameSender {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}

// Whether the browser attributes a connection to exactly this frame and document.
export function isFromFrame(tabId: number, frame: Pick<Frame, 'frameId' | 'documentId'>, sender: FrameSender | undefined): boolean {
  return (
    sender?.tab?.id === tabId &&
    sender.frameId === frame.frameId &&
    sender.documentId !== undefined &&
    sender.documentId === frame.documentId
  );
}

// Only the secrets this frame has a field for, and the entry has.
export function fieldsToReveal(report: FrameReport, available: string[]): RevealField[] {
  const fields: RevealField[] = [];
  if (report.hasPassword && available.includes('password')) fields.push('password');
  if (report.hasOtp && available.includes('totp')) fields.push('totp');
  return fields;
}
