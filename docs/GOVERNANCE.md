# Governance

What this project must always guarantee. Change this file before changing the behaviour.

1. **MCP only.** The extension and bridge never use `afproxy` or its native messaging host.
2. **Nothing without a user action.** No search, unlock or reveal on page load, and none started by a page.
3. **Only what the fill needs.** Reveal named fields of the one chosen entry. Never ask for `notes` or custom fields to fill a login.
4. **The browser decides the origin.** Match on the URL of the frame that will be filled, as the browser reports it, never one the page supplies. If that URL finds nothing, the bridge may search once more on the frame's registrable domain, using the Public Suffix List in the verified Strongbox app, and never above it. Values go only to that frame, and its origin and document are rechecked before revealing and before sending. They travel only on a connection the browser attributes to that frame and document, never in a message a browser could deliver elsewhere.
5. **Secrets are not kept.** No storage, cache or logs for secrets, in the extension or the bridge. Search queries and titles are not logged either.
6. **Fail closed.** An unexpected response, signature or origin means no fill.
7. **Approvals stay with Strongbox.** Never automate a pairing, unlock or authentication prompt. A user's request to fill may make Strongbox show one, but only the user answers it, in Strongbox.
8. **Per-reveal authentication is recommended.** Documentation recommends "Require authentication for all requests" and says what timed mode risks. The choice is the user's and stays in Strongbox.
9. **The helper and the bridge's parent are verified.** Check the helper's signature before launch. The bridge runs only under a listed browser, with that browser's signature and that browser's extension origin.
10. **No broad-runtime hosts.** Never pair `python`, `node`, a shell or a terminal to make the bridge work.
11. **A reveal consumes a recent search.** Only a returned entry and its advertised fields can be revealed on the same native connection. Unlocking, a new search, or a transport failure invalidates the previous search.
