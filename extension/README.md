# Strongbox MCP AutoFill

A browser extension for Helium, Chrome and Search that fills logins from
Strongbox through Strongbox's MCP interface, by way of the Strongbox Browser
Bridge (`../bridge`).

## What it does

- When you click its toolbar button, it asks Strongbox for logins that match the
  current site and lists them by title, username and vault. Locked vaults get an
  Unlock button.
- When you pick one, it fills the username and asks Strongbox for the password,
  plus the one-time code if the page has a field for it. With "Require
  authentication for all requests", Strongbox asks you to confirm with Touch ID.
- `Ctrl+Shift+L` (`Cmd+Shift+L` on a Mac) fills straight away if exactly one
  login matches, and otherwise opens the list.
- When you click into a username, password or one-time-code field, a small
  pop-in under the field offers "Fill login". Clicking it fills the login if
  only one matches, and otherwise shows the same list as the toolbar button, for
  the frame that field is in. ArrowDown in the field moves into the pop-in. Esc,
  a click elsewhere or leaving the field closes it.
- For a login spread over several pages, the entry you filled is remembered for
  that tab and site for 3 minutes: the pop-in offers "Continue with the same
  login", and the list shows it first. Only the entry's IDs are kept, in memory.
- While Strongbox asks for approval, Cancel stops the fill.

## What it doesn't do

- It does nothing until you click the button, press the shortcut or click
  the pop-in: no search on page load, and no search when a field gets focus.
  A small script in every page watches which field has focus so it can show the
  pop-in. It reads no values and doesn't contact Strongbox; the pop-in is an
  extension page the site can't read or click into.
- It doesn't save new logins, generate passwords or show notes.
- It doesn't keep, cache or log passwords, codes, titles or usernames.
- It makes no network requests.

It needs access to all sites so it can reach sign-in forms embedded from another
site, such as iCloud's, and show the pop-in. It still asks Strongbox only when you do. It searches Strongbox
with the address of the frame it will fill, and sends values only to that frame,
so a password only ever goes to the site its entry matched. If that address finds
nothing, it tries the site's main domain, so `accounts.example.com` finds a login
saved for `example.com`.

## Build

Needs Node 23.6 or later (the tests run TypeScript directly).

```sh
npm ci
npm run check   # type check and tests
npm run build   # writes dist/
```

## Install

1. Install the bridge first: run `bridge/install.sh` from this repository. It
   registers the bridge for Helium, Chrome and Search.
2. Install a build you trust under a root-owned directory in `/Library`. Run these
   commands from the repository root for a fresh install.

   ```sh
   sudo mkdir -m 0755 /Library/StrongboxMCPAutoFill
   sudo cp -R extension/dist/. /Library/StrongboxMCPAutoFill/
   sudo chown -R root:wheel /Library/StrongboxMCPAutoFill
   sudo chmod -R go-w /Library/StrongboxMCPAutoFill
   ```

   If the directory already exists, verify its ownership before updating it.
3. Load that directory in your browser. If you previously loaded the checkout
   build, remove that entry first.

   | Browser | Where | Extension ID the bridge accepts |
   | --- | --- | --- |
   | Helium | `helium://extensions`, **Load unpacked** | `lkgpmndbggpfaeenpehmblmbgmkbcbnk` |
   | Chrome | `chrome://extensions`, Developer mode, **Load unpacked** | `lkgpmndbggpfaeenpehmblmbgmkbcbnk` |
   | Search (macOS 15.4 or later) | Settings › Extensions, **Load an unpacked extension** | `nmoagjmbdnebfnhachgpglincjficfkg` |

   Search derives the ID from the folder's path, so it must be loaded from exactly
   `/Library/StrongboxMCPAutoFill`. After updating that folder, press **Reload** in
   Search's extension settings, then quit and reopen Search. Until then, the pop-in
   can lose its connection and open tabs can report that they have no login form.
   In Helium and Chrome, press the extension's reload button after updating, then
   reload open pages. A browser restart alone can keep the old background worker.
4. Click the toolbar button on a login page. The first time, Strongbox asks
   you to approve "Strongbox Browser Bridge" under Settings → Extensions →
   Paired MCP Hosts.
5. In Strongbox, turn off **Chrome & Firefox AutoFill Extension** and enable MCP
   access only for the vaults this integration needs, and keep pairing limited to
   trusted hosts.

**Require authentication for all requests** is the recommended setting: every
reveal then needs your approval. It is your choice. In timed mode, reveals are
silent during the session, so a tampered extension could read entries from
MCP-enabled vaults without a prompt until the session ends. That is still narrower
than the AutoFill proxy, which any local process can read while a vault is unlocked.

The protected directory prevents ordinary same-user edits to the build you load.
In Helium and Chrome, the user-owned profile and native messaging registration
remain part of the trust boundary. Search goes further: it copies the extension to
`~/Library/Application Support/Search/Extensions`, a user-writable folder, and adds
its own compatibility script to it. The bridge only runs under Search's own
signature, but you are trusting Search with your passwords as you do any browser
you sign in with. Strongbox owns the authentication policy, and the bridge cannot
verify the selected policy through MCP.

To change the shortcut, open `helium://extensions/shortcuts` or
`chrome://extensions/shortcuts`. Strongbox's own AutoFill extension suggests the
same key; if it is installed, the browser gives the key to whichever came first.

The icons in `icons/` are rendered from `../assets/icon.svg` by
`scripts/icons.sh` (macOS).

## License

AGPL-3.0. Page analysis and filling (`src/content/PageAnalyser.ts`,
`src/content/AutoFiller.ts`) come from Strongbox's
[browser-autofill](https://github.com/strongbox-password-safe/browser-autofill)
extension by Mark McGuill; the changes are noted at the top of each file.
