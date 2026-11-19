// Injected into the tab's frames when the user asks for a fill. It reports what
// its frame holds and fills values the background sends; it never sends values back.

import type { ContentRequest, FillResult } from '../messages.ts';
import type { FrameReport } from '../plan.ts';
import { AutoFiller, type FillValues } from './AutoFiller.ts';
import { PageAnalyser } from './PageAnalyser.ts';

declare global {
  var strongboxMcpAutoFill: boolean | undefined;
}

async function analyse(): Promise<FrameReport> {
  const inputs = await PageAnalyser.getAllInputs();
  const hasPassword = inputs.some(input => PageAnalyser.isPasswordInput(input));
  return {
    hasLogin: hasPassword || inputs.some(input => PageAnalyser.isUsernameInput(input)),
    hasPassword,
    hasOtp: inputs.some(input => PageAnalyser.isOtpInput(input)),
  };
}

// The values come over a port of their own, never in the "fill" message.
function receiveValues(): Promise<FillValues | undefined> {
  return new Promise(resolve => {
    const port = chrome.runtime.connect({ name: 'fill' });
    port.onMessage.addListener((values: FillValues) => {
      resolve(values);
      port.disconnect();
    });
    port.onDisconnect.addListener(() => resolve(undefined));
  });
}

async function fill(request: Extract<ContentRequest, { type: 'fill' }>): Promise<FillResult> {
  if (location.origin !== request.expectedOrigin) return 'wrong_origin';
  const values = await receiveValues();
  if (!values) return 'no_fields';
  const filled = await new AutoFiller().doIt(values);
  return filled ? 'filled' : 'no_fields';
}

// Each user action injects this file again; listen only once per frame.
if (!globalThis.strongboxMcpAutoFill) {
  globalThis.strongboxMcpAutoFill = true;

  chrome.runtime.onMessage.addListener((request: ContentRequest, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab) return false;
    if (request.type === 'analyse') {
      analyse().then(sendResponse, () => sendResponse(undefined));
      return true;
    }
    if (request.type === 'fill') {
      fill(request).then(sendResponse, () => sendResponse('no_fields'));
      return true;
    }
    return false;
  });
}
