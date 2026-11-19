# Design

Status: draft. Bridge and extension built for Helium, Chrome and Search. Real fills work in Search and Helium; Chrome is untested.
Observed on Strongbox 1.65.2 (Mac App Store build) and Search 1.0.14 on macOS 27.2, November 2026.

## Goal

Fill browser logins through Strongbox's MCP interface, so Strongbox's Browser
AutoFill server (`afproxy`) can be turned off.

`afproxy` does not check who calls it. While a vault is unlocked, any unsandboxed
process running as the user can read that vault's entries, secrets included. MCP
adds host pairing, metadata-only search, a reveal policy, an audit log and rate
limits.

## Non-goals

- Saving new logins or generating passwords. MCP has no write tools.
- Icons, favourites, tags and notes in the UI.
- Filling on page load.
- Windows, Linux and Safari. macOS only, in the browsers listed under "Browsers", with
  Zen planned.
- Store distribution, for now.

## Architecture

```
content script <-> extension background <-> bridge <-> strongbox-mcp <-> Strongbox
   (page)            (no secrets kept)     native      signed helper      socket
                                           messaging   newline JSON-RPC
```

A browser cannot talk to `strongbox-mcp` directly: native messaging uses
length-prefixed frames, and the helper uses newline-delimited JSON-RPC. So a small
bridge is needed. It is written in Swift because it needs the Security framework,
and it reuses the helper signature check and transport from StrongboxTunaExtension
(copied, MIT, same author). It exposes a fixed allowlist of operations, not raw MCP.

The bridge is an app bundle, `Strongbox Browser Bridge.app`, installed in
`/Applications`: Strongbox drops hosts installed anywhere else (see Findings). It is
signed with a real identity (Apple Development is enough) so the pairing survives
rebuilds and Strongbox shows no "Terminal or command-line host" caution. It never
takes `disable-library-validation`.

The extension is a fork of `strongbox-password-safe/browser-autofill` 1.2.3
(AGPL-3.0). Only its page analysis (`PageAnalyser`) and filling (`AutoFiller`) are
kept, with their notice. Upstream's background, React/MUI UI, webpack build, settings
and protocol all serve removed features (searching on every page load, whole
credentials in content scripts, entry creation, password generation, icons, notes),
so they are replaced by a small plain-TypeScript background and popup built with
esbuild. The repository is therefore AGPL-3.0.

## Bridge protocol

The extension opens one `runtime.connectNative` port per user action and closes it
when the fill finishes or fails, or after 2 minutes. The bridge keeps one MCP
connection for the life of the port. Messages are JSON; each request has an `id`
that its response repeats.

| Request | Response |
| --- | --- |
| `{id, op: "status"}` | `{id, databases: [{id, name, locked}]}` |
| `{id, op: "unlock", database_id}` | `{id, ok: true}` |
| `{id, op: "search", url, database_id?}` | `{id, matches: [{database_id, database_name, credential_id, title, username, available_fields}]}`, at most 20 |
| `{id, op: "reveal", database_id, credential_id, fields}` | `{id, values: {<field>: <string>}}` |

- Each successful search permits one reveal on that native connection for up to
  two minutes. The reveal must name a returned entry and fields it advertised.
  A new search, unlock, or broken transport clears the previous authorization.
- `fields` is a non-empty subset of `password` and `totp`. The bridge refuses any
  other field. The username comes from search, so it needs no reveal.
- `url` must be `http:` or `https:`, at most 2048 characters. The bridge drops its
  query, fragment and user info (they often carry tokens, and Strongbox's audit log
  keeps the URL), then passes it to `find_credentials` as `url`, never as `query`.
- If that finds nothing, the bridge searches once more on the registrable domain, so
  `accounts.example.com` finds a login saved for `example.com`. The domain comes from
  `public_suffix_list.dat` in the signature-checked Strongbox app, whose private
  entries keep `user.github.io` from reaching `github.io`. Hosts without a listed
  suffix, IP addresses and punycode hosts get no second search. Values still go only
  to the frame that was searched for.
- `id` is a string or number. A request without a usable `id` gets `id: null`. An
  oversized or truncated frame gets `invalid` and the bridge exits, since the next
  frame boundary can't be trusted.
- An error is `{id, error: <kind>}`, kind one of `not_paired`, `disabled`, `locked`,
  `denied`, `unavailable`, `invalid`, `timeout`. No Strongbox text is passed on.
- The bridge refuses to run unless its first argument is a listed extension origin and
  its parent process has the signature of a browser listed for that origin (see
  "Browsers"). It logs nothing about requests or values; stderr gets only a fixed error
  kind.
- `lock_database` is not exposed: Strongbox relocks vaults MCP opened by its own
  policy (immediately after each reveal with "Require authentication for all
  requests"), and leaves vaults the user unlocked alone.

## Browsers

| Browser | Signature | Extension ID comes from | Reads the registration in |
| --- | --- | --- | --- |
| Helium | `net.imput.helium`, Team `S4Q33XPHB4` | Manifest `key`: `lkgpmndbggpfaeenpehmblmbgmkbcbnk` | `net.imput.helium/NativeMessagingHosts` |
| Chrome | `com.google.Chrome`, Team `EQHXZ8M8AV` | Manifest `key`: `lkgpmndbggpfaeenpehmblmbgmkbcbnk` | `Google/Chrome/NativeMessagingHosts` |
| Search | `com.officecommun.search`, Team `7BYKA895MC` | Path of `/Library/StrongboxMCPAutoFill`: `nmoagjmbdnebfnhachgpglincjficfkg` | `Google/Chrome/NativeMessagingHosts` |

Folders are under `~/Library/Application Support`. Registering means writing the native
messaging manifest there: the host's name, the bridge's path and the allowed extension
origins. A browser stops at the first file with the host's name, so the file lists every
origin, and the bridge decides which browser may use which. Any process running as the
user can edit these files, so they are not a security boundary.

A browser is added only if it has a stable signature to check. Chromium builds without
one can't be told apart from any other program. Chrome's entry comes from public sources;
Chrome was not installed where this was built, so neither its signature nor a fill in it
has been checked.

## MCP surface

| Tool | Use |
| --- | --- |
| `list_databases` | Vault names, IDs and lock state |
| `unlock_database` | Prompts in Strongbox |
| `find_credentials` | `url` uses AutoFill's matching rules. Metadata only, 20 results at most |
| `reveal_credential` | Named fields only: `username`, `password`, `totp`, `url`, `notes`, `custom:<name>` |
| `lock_database` | Ends access. Never locks a vault the user unlocked. Not used |

`find_credentials` takes `query` or `url`, plus optional `database_id` and `limit`.
Without `database_id` it searches the unlocked, MCP-enabled vaults.

Search results hold title, username, vault and available field names. Field
references (`{REF:...}`) are not expanded, so those entries cannot be filled.
`totp` returns the current code, so the extension never holds the seed.

An unlocked vault is not always ready to reveal. Listing and search can succeed while
`reveal_credential` answers "Call unlock_database": Strongbox's messages cover timed access
without a session, an expired access grant and a changed policy. The bridge reports these as
`locked`, like a vault that really is locked.

## Fill flow

1. The user acts: opens the toolbar popup, presses the shortcut, or clicks in the
   pop-in (see "Pop-in"). Nothing contacts Strongbox before this. Strongbox
   rate-limits MCP requests, and searching on every page load would also tell
   Strongbox every site visited.
2. The background injects the fill script into all of the tab's frames (host access
   to all http(s) sites; the only static script is the pop-in's focus watcher), takes frame URLs from
   `webNavigation`, and asks each frame which username, password and one-time-code
   fields it holds. It picks the frame to fill (one with a password field first, top
   frame first) and pins it by `documentId`.
3. The background calls `status`, then `search` with that frame's URL as the browser
   reports it, never a URL supplied by the page or content script. An embedded
   sign-in frame such as iCloud's therefore matches its own site, and the popup names
   that site. Locked vaults are listed with an Unlock button; unlocking prompts in
   Strongbox, then search reruns. The user picks an entry. The shortcut fills only a
   single match and otherwise opens the popup (or shows a "?" badge if the browser
   won't open it). The pop-in fills without a second pick when the choice is clear
   (see "Pop-in").
4. At fill time the pinned frame is asked again, since a two-step login may have
   changed its fields.
5. The background checks that the tab's origin and the frame's document have not
   changed, then reveals only what that frame needs: `password` if it has a password
   field, `totp` if it has a one-time-code field. A username-only step is filled from
   search metadata with no reveal. Strongbox asks for Touch ID if its policy says so.
   If it answers that `unlock_database` is needed, the background calls it once, which
   prompts in Strongbox, then searches again, rechecks the frame and repeats the reveal.
6. The background checks the origin again and tells that document to fill, naming the
   expected origin; the content script refuses if `location.origin` differs. The
   message holds no values. The content script opens a runtime port, and the background
   sends the values once, only if the browser attributes that port to the pinned tab,
   frame and document. Secrets are not stored, logged or cached anywhere.

Messages to a frame name only its `documentId`. It is stricter than `frameId`, which stays
the same when the frame navigates, and WebKit refuses the two together. A frame the browser
reports without a `documentId` is skipped, since a message with no target reaches every
frame in the tab.

The first release has no settings. The popup lists title, username and vault only,
under the site's host.

While a fill or unlock waits, the view offers Cancel. After 1.5 seconds it says that
Strongbox is waiting for approval, since its prompt opens in another window. Cancel
closes the native connection, so an approval that comes later fills nothing; the
background also checks that the connection is still open just before sending values.
A successful fill shows "Filled" for 0.6 seconds before the view closes.

### Last used entry

After a fill, the background keeps the entry's database and credential IDs for that
tab and origin for 3 minutes, in `chrome.storage.session` (memory only, readable by
extension pages but not content scripts). No values, titles or usernames are kept.
It serves the next step of a login, such as the password page after the username page:
the popup lists that entry first, marked "Last used", and the pop-in offers "Continue
with the same login". It is only a preference: the entry must still be in the search
results for the frame being filled, so it can't carry a login to another site.

## Pop-in

A pop-in under a focused login field, like the browser's own passkey prompt.

- A small static content script runs in every http(s) frame. It only listens for
  focus. When a username, password or one-time-code field gets focus, it shows the
  pop-in under that field. It sends nothing to Strongbox, and on page load it sends
  nothing at all.
- Focus is not a user action: pages can focus fields themselves (`autofocus`). So
  the pop-in first shows only "Fill login" (or "Continue with the same login", see
  "Last used entry"). Strongbox is contacted when the user clicks it, never on focus.
- That click is the request to fill. If Strongbox has only one vault for MCP and it is
  locked, the pop-in asks to unlock it straight away instead of showing an Unlock
  button, once per attempt. If the search then finds the last used entry, or
  exactly one match, the pop-in fills it straight away, as the shortcut does for a
  single match. Otherwise it shows the list. A page that tricks the user into this
  click (see below) therefore gets a fill in one click instead of two; the result is
  still only that site's own login, and still behind Strongbox's prompt if its policy
  asks for one.
- The pop-in is as wide as the field, between 260 and 360 pixels.
- The pop-in is an iframe of an extension page (`menu.html`), so the page can't read
  the titles and usernames in it or click inside it. It is a web-accessible resource
  with `use_dynamic_url`. The content script gets a one-time token from the
  background, bound to the tab, frame and document the message came from, and
  passes it in the iframe URL. The background serves a menu only for a token it
  issued, and fills only that frame. A menu without a valid token fails closed.
- After the click, the flow is the same as the popup's, with the frame fixed: status,
  search with the frame's URL, unlock if needed, pick, then reveal and fill, with the
  same origin and document rechecks.
- The menu presents its token in a first `hello` message. The token is used up
  before any check, and the menu must be `menu.html` in the token's tab, in a frame
  of its own. Its parent frame is not checked: Helium's `webNavigation` doesn't list
  extension frames at all (checked in a VM with `getAllFrames`). The single-use token, handed only to our script in the bound
  frame, is the binding.
- The pop-in also opens on a click into a login field that already has focus, and
  for a field focused before the script ran (iCloud focuses its field itself).
- The pop-in closes on Esc, a click outside, the field losing focus, a fill, or two
  minutes without a request. After an error it stays open with "Try again", so the
  message can be read. It follows the field on scroll and resize.
- Keyboard: ArrowDown in the field moves focus into the pop-in, arrow keys move between
  its buttons, and the first login gets focus when the list loads, so Enter fills it.
  When the pop-in closes with focus inside it, focus goes back to the field without
  reopening it.
- The page can see the iframe's height, and so roughly how many logins are listed
  for its own site. Accepted: it reveals nothing about other sites.
- A page can still style or cover the iframe's host element (clickjacking). The
  worst it can trick a user into is filling that site's own matching login into
  that site, after a Touch ID prompt.

Upstream differs here: it holds whole credentials in the background and sends them
to the content script, including fields the fill does not use.

## Findings

### AutoFill cannot be fully off

There are two separate settings:

- **Browser AutoFill**, under Integrations (`runBrowserAutoFillProxyServer`). The
  public source starts `afproxy`'s server only when this is on.
- **Per-vault AutoFill.** The app's UI text says "Greyed-out vaults need AutoFill
  enabled before MCP can use them."

So the target setup is Browser AutoFill **off**, per-vault AutoFill **on**. MCP keeps
working with the global toggle off (see "An ad-hoc-signed host did not work"). Not yet
checked: that the `afproxy` socket then goes away.

### Pairing does not stop other local processes using the bridge

Strongbox pairs the program that launches the helper. Once the bridge is paired,
any process running as the user could launch the bridge and send it requests.
Search would then work for that process without further approval.

The bridge should therefore refuse to run unless its parent is a browser with an
expected signature, checked by audit token. That raises the cost but is not a hard
boundary: a same-user attacker can also start the browser with a modified profile.

**The real boundary is "Require authentication for all requests".** Each reveal then
needs device-owner authentication. An attacker gets metadata at most, plus a Touch
ID prompt nobody asked for. This is the recommended setting, and the choice is the
user's. In timed mode reveals are silent during the session, so an attacker who can drive
a listed browser or tamper with its extension can read MCP-enabled vaults until the
session ends.

| | `afproxy` today | MCP, timed session | MCP with per-reveal auth |
| --- | --- | --- | --- |
| Any local process reads secrets | Yes, silently, while unlocked | Only by going through a listed browser | Only with a Touch ID approval |
| Any local process reads metadata | Yes | Only by going through a listed browser | Only by going through a listed browser, with the vault unlocked |
| Limited to MCP-enabled vaults | No | Yes | Yes |
| Audit log and rate limit | No | Yes | Yes |

### Search is WebKit with its own Chrome compatibility layer

Search runs Chrome extensions on `WKWebExtension`, the engine Safari uses. It has no way to
load a Safari extension bundle, so this one extension serves it too. It cannot use Safari's
password AutoFill: Safari holds Apple-only entitlements for that
(`com.apple.authentication-services.access-credential-identities`), and Search has none.

- **The ID comes from the folder.** Search ignores the manifest `key`, so that a folder can't
  claim another extension's ID, and hashes the real path the way Chromium does for a keyless
  unpacked extension. Store installs keep their store ID.
- **It runs a modified copy.** Search copies the extension to
  `~/Library/Application Support/Search/Extensions/<id>`, puts a 210 KB compatibility script in
  front of `background.js`, and adds it to the HTML pages and content scripts. Our code follows
  unchanged. The copy is user-writable and no integrity check of it was found, so the
  root-owned install protects only the source folder. Search replaces the script on updates.
- **`tabs.sendMessage` reaches more than its target.** Without a `frameId`, the script also hands
  the message to the extension's own pages framed in the tab. Checked with a probe: a secret
  sent this way reached `menu.html`. This is why values travel on the port (Fill flow, step 6).
- **Reload needs a restart.** After **Reload**, the pop-in's connection dropped as soon as it
  opened, on every page, until Search was restarted. The instrumented `menu.js` from the new
  build didn't run in those pop-ins, which points to pages getting old cached copies of the
  extension's files, including an old worker generation in Search's script. The toolbar popup
  still opened, but a tab left open reported no login form. Restarting Search clears both, so
  the install steps require it.
- **Tested without Strongbox.** A throwaway host ran the built extension on the system WebKit,
  with and without Search's script, against local pages and a fake bridge. The popup, an embedded
  sign-in frame and the pop-in each filled only the target frame, and no extension page received
  the password in a message.
- **Tested with Strongbox.** In a VM with Strongbox 1.65.2 and a throwaway vault, the popup and the
  pop-in filled logins in Search with per-request and timed authentication, and the pop-in filled
  one in Helium with per-request authentication.

### An ad-hoc-signed host did not work

`list_databases` was run from `strongbox-mcp` under different parents. No vault data
was requested or returned.

| Parent of helper | Result |
| --- | --- |
| `/usr/bin/python3` (Apple-signed) | "This MCP host is not paired", the normal reply |
| Ad-hoc C, in a temp dir, in home, or in a hardened `.app` | "The Strongbox MCP socket is not owned by the expected signed Strongbox application." |
| Ad-hoc Swift, plain or hardened | Helper exits with status 13 (SIGPIPE) |
| Ad-hoc binary -> `sh` -> `python3` | "This MCP host is not paired" |
| Ad-hoc Swift bridge launched by Helium (first spike) | `initialize` answered; helper killed by SIGPIPE on `list_databases`, empty stderr, no entry under Paired MCP Hosts |
| Same, signed Apple Development (personal team, hardened runtime), bare and as a `.app` | Same (Browser AutoFill off) |
| The signed `.app` bridge launched from a shell | Same, so Helium's launch context is not the cause |
| The same signed `.app`, copied to `/Applications` | "This MCP host is not paired", the normal reply |
| An ad-hoc copy in `/Applications` | "This MCP host is not paired" |

Stderr handling and SIGPIPE disposition made no difference. The cause is not
established. The app's strings include an `adhoc:...|path:...|hash:...` identity
format, so ad-hoc hosts may be meant to work. StrongboxTunaExtension's notes
report Tuna working as a host (signature not checked here). A Developer ID parent and a
Homebrew runtime parent were not tried.

The browser launch settles where the check happens. Helium (Team `S4Q33XPHB4`) was the
bridge's direct parent, yet the result matched the other ad-hoc Swift hosts, so Strongbox
judges the helper's immediate parent, not the browser. `initialize` is answered by the helper
alone; the connection to Strongbox drops at the first tool call, before any pairing entry is
created. The server's `initialize` instructions say "The Strongbox user must pair this signed
host". So the bridge itself needs a real signature.

Disassembly of 1.65.2 confirms this: Strongbox takes the socket peer's PID (the helper), reads
its `pbi_ppid`, and validates that parent with `SecCode` (null explicit requirement), then reads
its team, identifier, designated requirement, flags and entitlements. No responsible-process
lookup was seen. The helper sets no `SO_NOSIGPIPE`, so the SIGPIPE is most likely Strongbox
closing the socket. Nothing is logged. The MCP socket stays open with Browser AutoFill off.
**Resolved: the host must be installed under `/Applications`.** The certificate doesn't
matter; an ad-hoc host there is accepted too. Every failing host above lived elsewhere, and
both working hosts (Tuna, Xcode's `Python.app`) live there. Browser AutoFill doesn't matter
either: Tuna works with it off, and the bridge failed outside `/Applications` with it on.
An ad-hoc identity probably includes the binary's hash (`adhoc:path|hash`), so each rebuild
would need a new pairing. A real signing identity, even a free Apple Development one, should
keep the pairing across rebuilds.

The spike then worked end to end: Helium launched the Apple Development-signed bridge from
`/Applications`, the user approved it for the session, and `list_databases` returned the
vaults. Strongbox showed no "Terminal or command-line host" caution, unlike Tuna. The
ad-hoc copy's pending request did show it, so the caution depends on the signature: ad-hoc
or `disable-library-validation` (Tuna) triggers it. The bridge must therefore be signed with
a real identity and must not take that entitlement.

Launching the helper through `python3` is not an acceptable workaround. It would
pair Python itself, and then any Python script could use that pairing.

## Open questions

1. ~~What signature does a host need?~~ Any, if it is installed under `/Applications`.
2. ~~Does MCP keep working with Browser AutoFill off?~~ Yes, checked with Tuna.
3. How low is the rate limit, and is a Touch ID prompt on every fill acceptable?

## Plan

1. ~~Settle questions 1 and 2.~~ Done.
2. ~~Spike: bridge and a one-button test extension in Helium, against the dummy vault.~~
   Done: pairing and `list_databases` work. The bridge installs under `/Applications`.
3. ~~Production bridge (`bridge/`) and extension (`extension/`) for Helium, as above.~~
   Built.
4. ~~Chrome and Search support.~~ Built. Real fills checked in Search and Helium, not yet in Chrome.
5. ~~A top-level README with install steps and the settings to change.~~ Done.
6. Zen. Real fills in Chrome.
7. Decide how to distribute: the Chrome Web Store would give every browser one extension ID,
   and an installer would keep the fixed folder.
