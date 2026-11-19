import Foundation
import XCTest
@testable import BridgeCore

final class BridgeTests: XCTestCase {
    private let vault = "a0000000-0000-4000-8000-000000000001"
    private let entry = "a0000000-0000-4000-8000-000000000002"

    private final class FakeTransport: MCPTransport {
        var calls: [StrongboxTool] = []
        var arguments: [String: JSONValue] = [:]
        var result: Result<JSONValue, StrongboxError> = .success(.object([:]))

        func tool(_ tool: StrongboxTool, arguments: [String: JSONValue]) throws -> JSONValue {
            calls.append(tool)
            self.arguments = arguments
            return try result.get()
        }
    }

    private func json(_ source: String) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: Data(source.utf8))
    }

    private func send(_ source: String, to bridge: Bridge) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: bridge.reply(to: Data(source.utf8)))
    }

    private func reveal(_ fields: String) -> String {
        """
        {"id":4,"op":"reveal","database_id":"\(vault)","credential_id":"\(entry)","fields":\(fields)}
        """
    }

    func testOperations() throws {
        let fake = FakeTransport()
        let bridge = Bridge { fake }

        fake.result = .success(try json("""
        {"databases":[{"database_id":"\(vault)","database_name":"Example","locked":true}]}
        """))
        let status = try send(#"{"id":"status","op":"status"}"#, to: bridge)
        XCTAssertEqual(status["id"]?.string, "status")
        XCTAssertEqual(status["databases"]?.array?.first?["id"]?.string, vault)
        XCTAssertEqual(status["databases"]?.array?.first?["locked"]?.boolean, true)

        fake.result = .success(try json(#"{"unlocked":true}"#))
        let unlock = try send("""
        {"id":2,"op":"unlock","database_id":"\(vault)"}
        """, to: bridge)
        XCTAssertEqual(unlock["ok"]?.boolean, true)
        XCTAssertEqual(fake.arguments["database_id"]?.string, vault)

        fake.result = .success(try match(fields: #"["password","totp"]"#))
        let search = try send("""
        {"id":3,"op":"search","url":"https://user:pw@example.test/a?token=1#x","database_id":"\(vault.uppercased())"}
        """, to: bridge)
        XCTAssertEqual(search["matches"]?.array?.first?["credential_id"]?.string, entry)
        XCTAssertEqual(fake.arguments["url"]?.string, "https://example.test/a")
        XCTAssertEqual(fake.arguments["limit"]?.number, 20)
        XCTAssertNil(fake.arguments["query"])

        fake.result = .success(try json(#"{"fields":{"password":"sample","totp":"000000","notes":"ignored"}}"#))
        let revealed = try send(reveal(#"["password","totp"]"#), to: bridge)
        XCTAssertEqual(revealed["values"]?["password"]?.string, "sample")
        XCTAssertEqual(revealed["values"]?["totp"]?.string, "000000")
        XCTAssertNil(revealed["values"]?["notes"])
        XCTAssertEqual(fake.calls, [.list, .unlock, .search, .reveal])
    }

    func testInvalidRequestsDoNotConnect() throws {
        let bridge = Bridge {
            XCTFail("Invalid request connected")
            throw StrongboxError.unavailable
        }
        let requests = [
            "", "[]", "{", #"{"op":"status"}"#, #"{"id":1,"op":"lock"}"#,
            #"{"id":1,"op":"unlock","database_id":"bad"}"#,
            #"{"id":1,"op":"search","url":"ftp://example.test"}"#,
            #"{"id":1,"op":"search","url":"https:relative"}"#,
            #"{"id":1,"op":"search","url":"https://example.test/a b"}"#,
            #"{"id":1,"op":"search","url":"https://example.test","database_id":null}"#,
            #"{"id":1,"op":"search","url":"https://example.test","database_id":"bad"}"#,
            """
            {"id":1,"op":"search","url":"https://example.test/\(String(repeating: "a", count: 2048))"}
            """,
            """
            {"id":1,"op":"reveal","database_id":"\(vault)","credential_id":"bad","fields":["password"]}
            """,
            reveal("[]"), reveal(#"["username"]"#), reveal(#"["password","notes"]"#),
            reveal(#"["custom:Email"]"#), reveal(#"["password","password"]"#), reveal("[1]"),
        ]
        for request in requests {
            XCTAssertEqual(try send(request, to: bridge)["error"]?.string, "invalid")
        }
    }

    private func match(database: String? = nil, credential: String? = nil, fields: String = #"["password"]"#) throws -> JSONValue {
        try json("""
        {"matches":[{"database_id":"\(database ?? vault)","database_name":"Example",        "credential_id":"\(credential ?? entry)","title":"Sample","username":"sample",        "available_fields":\(fields)}]}
        """)
    }

    func testSearchRejectsInvalidIDsAndWrongVault() throws {
        let fake = FakeTransport()
        let bridge = Bridge { fake }
        for result in [try match(database: "bad"), try match(credential: "bad")] {
            fake.result = .success(result)
            let response = try send(#"{"id":1,"op":"search","url":"http://example.test"}"#, to: bridge)
            XCTAssertEqual(response["error"]?.string, "invalid")
        }
        fake.result = .success(try match(database: entry))
        let response = try send("""
        {"id":1,"op":"search","url":"https://example.test","database_id":"\(vault)"}
        """, to: bridge)
        XCTAssertEqual(response["error"]?.string, "invalid")
    }

    private func authorizeSearch(_ bridge: Bridge, using fake: FakeTransport) throws {
        fake.result = .success(try match())
        let response = try send(#"{"id":3,"op":"search","url":"https://example.test"}"#, to: bridge)
        XCTAssertNotNil(response["matches"])
    }

    private final class SearchTransport: MCPTransport {
        var urls: [String] = []
        var found: [String: JSONValue] = [:]

        func tool(_ tool: StrongboxTool, arguments: [String: JSONValue]) throws -> JSONValue {
            let url = arguments["url"]?.string ?? ""
            urls.append(url)
            return found[url] ?? .object(["matches": .array([])])
        }
    }

    private func search(_ url: String, with fake: SearchTransport) throws -> JSONValue {
        let bridge = Bridge(connect: { fake }, suffixes: { PublicSuffixList("com\nco.uk\ngithub.io\n") })
        return try send(#"{"id":1,"op":"search","url":"\#(url)"}"#, to: bridge)
    }

    func testSearchFallsBackToRegistrableDomain() throws {
        let fake = SearchTransport()
        fake.found["https://example.com/"] = try match()
        let response = try search("https://accounts.example.com:8443/login?x=1", with: fake)
        XCTAssertEqual(response["matches"]?.array?.count, 1)
        XCTAssertEqual(fake.urls, ["https://accounts.example.com:8443/login", "https://example.com/"])
    }

    func testExactMatchNeedsNoFallback() throws {
        let fake = SearchTransport()
        fake.found["https://accounts.example.com/"] = try match()
        _ = try search("https://accounts.example.com/", with: fake)
        XCTAssertEqual(fake.urls, ["https://accounts.example.com/"])
    }

    func testFallbackStaysBelowPublicSuffix() throws {
        for (url, searches) in [("https://example.com/", 1), ("https://user.github.io/", 1), ("https://sonarr.lan/", 1),
                                ("https://192.168.1.2/", 1), ("https://a.user.github.io/", 2)] {
            let fake = SearchTransport()
            XCTAssertEqual(try search(url, with: fake)["matches"]?.array?.count, 0)
            XCTAssertEqual(fake.urls.count, searches, url)
            XCTAssertFalse(fake.urls.contains("https://github.io/"), url)
        }
    }

    func testFallbackMatchCanBeRevealed() throws {
        let fake = SearchTransport()
        fake.found["https://example.com/"] = try match()
        fake.found[""] = try json(#"{"password":"sample"}"#) // reveal carries no URL
        let bridge = Bridge(connect: { fake }, suffixes: { PublicSuffixList("com\n") })
        _ = try send(#"{"id":1,"op":"search","url":"https://accounts.example.com/"}"#, to: bridge)
        XCTAssertEqual(try send(reveal(#"["password"]"#), to: bridge)["values"]?["password"]?.string, "sample")
    }

    func testPublicSuffixRules() {
        let list = PublicSuffixList("// comment\ncom\nco.uk\n*.ck\n!www.ck\n")
        XCTAssertEqual(list.registrableDomain(of: "Accounts.Example.COM"), "example.com")
        XCTAssertEqual(list.registrableDomain(of: "a.b.example.co.uk"), "example.co.uk")
        XCTAssertEqual(list.registrableDomain(of: "a.b.example.ck"), "b.example.ck")
        XCTAssertEqual(list.registrableDomain(of: "a.www.ck"), "www.ck")
        for host in ["com", "co.uk", "example.ck", "example.unlisted", "127.0.0.1", "::1", "a.example.com.", "xn--a.example.com"] {
            XCTAssertNil(list.registrableDomain(of: host), host)
        }
    }

    func testRevealRequiresAndConsumesMatchingSearch() throws {
        let fake = FakeTransport()
        let bridge = Bridge { fake }
        let request = reveal(#"["password"]"#)
        XCTAssertEqual(try send(request, to: bridge)["error"]?.string, "denied")
        try authorizeSearch(bridge, using: fake)
        XCTAssertEqual(try send(reveal(#"["totp"]"#), to: bridge)["error"]?.string, "denied")
        fake.result = .success(try json(#"{"password":"sample"}"#))
        XCTAssertNotNil(try send(request, to: bridge)["values"])
        XCTAssertEqual(try send(request, to: bridge)["error"]?.string, "denied")
        XCTAssertEqual(fake.calls, [.search, .reveal])
    }

    func testRevealShapesAndUnavailableValues() throws {
        let fake = FakeTransport()
        let bridge = Bridge { fake }
        let request = reveal(#"["password"]"#)
        for source in [
            #"{"password":"sample"}"#,
            #"{"revealed_credential":{"fields":{"password":{"value":"sample"}}}}"#,
            #"{"fields":[{"field":"password","value":"sample"}]}"#,
        ] {
            try authorizeSearch(bridge, using: fake)
            fake.result = .success(try json(source))
            XCTAssertEqual(try send(request, to: bridge)["values"]?["password"]?.string, "sample")
        }
        for source in [
            #"{"password":""}"#,
            #"{"password":"{REF:P@I:example}"}"#,
            #"{"revealed_credential":{"unavailable_fields":["password"],"password":"sample"}}"#,
        ] {
            try authorizeSearch(bridge, using: fake)
            fake.result = .success(try json(source))
            let response = try send(request, to: bridge)
            XCTAssertEqual(response["error"]?.string, "unavailable")
            XCTAssertNil(response["values"])
        }
        try authorizeSearch(bridge, using: fake)
        fake.result = .success(.object([:]))
        XCTAssertEqual(try send(request, to: bridge)["error"]?.string, "invalid")
    }

    func testErrorMappingAndTransportReset() throws {
        let fake = FakeTransport()
        var connections = 0
        let bridge = Bridge {
            connections += 1
            return fake
        }
        let request = #"{"id":1,"op":"status"}"#
        for (failure, expected) in [
            (StrongboxError.toolError("This MCP host is not paired"), "not_paired"),
            (.toolError("Strongbox MCP access is disabled"), "disabled"),
            (.toolError("The database is locked"), "locked"),
            (.toolError("Call unlock_database"), "locked"),
            (.toolError("Private server message"), "denied"),
            (.timedOut, "timeout"),
            (.disconnected, "unavailable"),
            (.invalidResponse, "invalid"),
            (.untrustedHelper, "unavailable"),
        ] {
            fake.result = .failure(failure)
            let response = try send(request, to: bridge)
            XCTAssertEqual(response["error"]?.string, expected)
            XCTAssertEqual(response["id"]?.number, 1)
        }
        XCTAssertEqual(connections, 4)
    }

    func testOversizeResponseReturnsInvalid() throws {
        let fake = FakeTransport()
        let bridge = Bridge { fake }
        try authorizeSearch(bridge, using: fake)
        fake.result = .success(.object(["password": .string(String(repeating: "a", count: Framing.responseLimit))]))
        XCTAssertEqual(try send(reveal(#"["password"]"#), to: bridge)["error"]?.string, "invalid")
    }

    private func identifiers(_ arguments: [String]) -> [String] {
        Host.browsers(for: arguments).map(\.identifier)
    }

    func testEachOriginAllowsOnlyItsBrowsers() {
        XCTAssertEqual(identifiers(["bridge", "chrome-extension://lkgpmndbggpfaeenpehmblmbgmkbcbnk/"]),
                       ["net.imput.helium", "com.google.Chrome"])
        XCTAssertEqual(identifiers(["bridge", "chrome-extension://nmoagjmbdnebfnhachgpglincjficfkg/"]),
                       ["com.officecommun.search"])
    }

    func testUnknownOriginsAllowNoBrowser() {
        XCTAssertEqual(identifiers(["bridge"]), [])
        XCTAssertEqual(identifiers(["bridge", String(Host.keyedOrigin.dropLast())]), [])
        XCTAssertEqual(identifiers(["bridge", "other", Host.keyedOrigin]), [])
    }

    func testBrowserRequirementsAreValid() {
        for browser in Host.browsers {
            XCTAssertNotNil(browser.requirement, browser.identifier)
        }
    }
}
