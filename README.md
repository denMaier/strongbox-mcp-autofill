<img src="assets/icon.svg" width="64" height="64" alt="">

# Strongbox MCP AutoFill

Browser AutoFill for [Strongbox](https://strongboxsafe.com) that runs through
Strongbox's MCP interface instead of the AutoFill proxy (`afproxy`).

A side project: when Strongbox 1.65.1 added a built-in MCP server, I wanted to see
whether the browser could use the same, well-guarded way in as AI agents do. It
can. Logins fill in Helium and Search with Browser AutoFill switched off.

```
content script <-> extension background <-> bridge <-> strongbox-mcp <-> Strongbox
   (page)            (keeps no secrets)     native      Strongbox's       socket
                                            messaging   signed helper
```

## Why MCP

The AutoFill proxy answers whoever talks to it. Strongbox's own write-up says a
program that pretends to be Chrome can ask it for passwords while a vault is
unlocked. MCP already checks callers, so browser fills get that for free:

| | `afproxy` | MCP, timed session | MCP, "Require authentication for all requests" |
| --- | --- | --- | --- |
| Another local program reads secrets | Yes, silently, while unlocked | Only by going through a listed browser | Only after a Touch ID approval |
| Limited to vaults enabled for MCP | No | Yes | Yes |
| Caller paired and approved in Strongbox | No | Yes | Yes |
| Search returns metadata only | No | Yes | Yes |
| Audit log and rate limits | No | Yes | Yes |

For Strongbox it would also mean one local API to maintain and harden instead of two.

## What it does

- Fills the username, password and one-time code for the site you're on, when you
  click the toolbar button, press `Cmd+Shift+L`, or click the pop-in under a login
  field.
- Searches with the address of the frame being filled, as the browser reports it,
  and sends values only to that frame.
- Asks Strongbox only for `password` and `totp`, and only for the entry you picked.
  The username comes from the search, without a reveal.

## What it doesn't do

- Nothing on page load. Strongbox hears about a site only when you ask to fill.
- No saving logins or generating passwords: MCP has no write tools.
- No storing, caching or logging of passwords, codes, titles or usernames.
- No network requests.
- macOS only. Helium and Search are tested. Chrome should work but hasn't been tried.

## The bridge

Browsers speak native messaging and `strongbox-mcp` speaks newline-delimited
JSON-RPC, so a small bridge translates between them. Like `afproxy`, it is a process
the browser starts. Unlike `afproxy`, it adds no access of its own: every request
passes through Strongbox's pairing and authentication, the same as for an agent.

- Four fixed operations: `status`, `unlock`, `search`, `reveal`. No raw MCP.
- A reveal must name an entry, and fields, from the last search on the same
  connection.
- It runs only under a browser with the expected code signature and extension ID,
  and checks `strongbox-mcp`'s signature before starting it.

Strongbox pairs the program that starts `strongbox-mcp`, which is the bridge. The
parent-browser check makes misuse harder but is not a hard boundary. Per-request
authentication is.

## Notes for the Strongbox team

Things I ran into, in case they're useful:

- **Vault access per paired host.** Vaults are enabled for MCP globally, so enabling
  my everyday vault for the browser also enables it for every agent. A per-host list
  (and per-host authentication mode) would let both live side by side.
- **Hosts outside `/Applications` fail silently.** The helper is killed by SIGPIPE at
  the first tool call, with no log entry and no pairing request.
- **Browser AutoFill can't be fully off.** MCP access needs each vault's AutoFill
  setting on.
- **"Searchable but not revealable"** (for example after timed access expires) only
  comes back as message text. An error code would be easier to handle.
- **`{REF:...}` references** aren't expanded by `reveal_credential`.
- **No bridge needed** if `strongbox-mcp` could also speak native messaging framing:
  the browser would then be the paired host itself.

## Try it

You need Strongbox 1.65.1 or later with MCP enabled, Xcode, Node 23.6 or later, and
an Apple Development signing identity.

1. Install the bridge: `bridge/install.sh`. It builds and signs
   `/Applications/Strongbox Browser Bridge.app` and registers it with Helium,
   Chrome and Search.
2. Build and load the extension: see [extension/README.md](extension/README.md).
3. In Strongbox: approve "Strongbox Browser Bridge" when asked, turn off
   **Chrome & Firefox AutoFill Extension**, and enable MCP only for the vaults you
   want filled. "Require authentication for all requests" is recommended.

## More

- [docs/DESIGN.md](docs/DESIGN.md): how it works, the bridge protocol, and what was
  found and tested along the way.
- [docs/GOVERNANCE.md](docs/GOVERNANCE.md): what the project must always guarantee.

## License

The extension is AGPL-3.0 ([LICENSE](LICENSE)): its page analysis and filling come
from Strongbox's [browser-autofill](https://github.com/strongbox-password-safe/browser-autofill)
by Mark McGuill. The bridge is MIT ([bridge/LICENSE-MIT](bridge/LICENSE-MIT)).

Not affiliated with Strongbox.
