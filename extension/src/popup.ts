// The toolbar popup. It asks Strongbox as soon as it opens: opening it is the user's action.

import type { ViewRequest } from './messages.ts';
import { createView } from './view.ts';

const port = chrome.runtime.connect({ name: 'popup' });
const send = (request: ViewRequest) => port.postMessage(request);
const view = createView(send, {
  autoFill: false,
  filled: () => window.close(),
  retry: () => location.reload(),
  cancel: () => window.close(),
});

port.onMessage.addListener(view.receive);

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab?.id === undefined) view.fail('no_page');
  else send({ type: 'open', tabId: tab.id });
});
