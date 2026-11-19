import Foundation

final class Bridge {
    private let connect: () throws -> MCPTransport
    private var connection: MCPTransport?
    private var searchGrant: (matches: [MatchList.Match], expires: ContinuousClock.Instant)?
    private let clock = ContinuousClock()
    private let loadSuffixes: () -> PublicSuffixList?
    private lazy var suffixes = loadSuffixes()

    init(connect: @escaping () throws -> MCPTransport, suffixes: @escaping () -> PublicSuffixList? = { nil }) {
        self.connect = connect
        loadSuffixes = suffixes
    }

    func reply(to body: Data) throws -> Data {
        let request = String(data: body, encoding: .utf8) == nil ? nil
            : try? JSONDecoder().decode(JSONValue.self, from: body)
        let candidate = request?["id"]
        let id = candidate?.string != nil || candidate?.number != nil ? candidate : nil
        guard let request, let id else { return try errorReply(.invalidRequest) }

        do {
            var response = try handle(request)
            response["id"] = id
            let data = try JSONEncoder().encode(JSONValue.object(response))
            guard data.count <= Framing.responseLimit else {
                searchGrant = nil
                throw StrongboxError.invalidResponse
            }
            return data
        } catch {
            return try errorReply(error as? StrongboxError ?? .invalidResponse, id: id)
        }
    }

    private func handle(_ request: JSONValue) throws -> [String: JSONValue] {
        switch request["op"]?.string {
        case "status":
            let result = try tool(.list).decoded(as: DatabaseList.self)
            let databases = try result.databases.map { database -> JSONValue in
                guard UUID(uuidString: database.database_id) != nil else { throw StrongboxError.invalidResponse }
                return .object([
                    "id": .string(database.database_id), "name": .string(database.database_name),
                    "locked": .bool(database.locked),
                ])
            }
            return ["databases": .array(databases)]

        case "unlock":
            searchGrant = nil
            let databaseID = try identifier(request["database_id"])
            let result = try tool(.unlock, ["database_id": .string(databaseID)])
            guard case .object = result else { throw StrongboxError.invalidResponse }
            if result["unlocked"]?.boolean == false || result["ok"]?.boolean == false
                || result["locked"]?.boolean == true {
                throw StrongboxError.denied
            }
            return ["ok": .bool(true)]

        case "search":
            searchGrant = nil
            guard let url = request["url"]?.string, url.count <= 2048,
                  let parsed = URL(string: url, encodingInvalidCharacters: false),
                  let scheme = parsed.scheme?.lowercased(), ["http", "https"].contains(scheme),
                  let host = parsed.host(), !host.isEmpty,
                  var components = URLComponents(url: parsed, resolvingAgainstBaseURL: false) else {
                throw StrongboxError.invalidRequest
            }
            // Queries, fragments and credentials often carry tokens, and Strongbox's audit log keeps the URL.
            components.query = nil
            components.fragment = nil
            components.user = nil
            components.password = nil
            guard let matchURL = components.string else { throw StrongboxError.invalidRequest }
            let databaseID = try request["database_id"].map { try identifier($0) }
            var matches = try search(matchURL, databaseID: databaseID)
            if matches.isEmpty, let domainURL = registrableDomainURL(of: components) {
                matches = try search(domainURL, databaseID: databaseID)
            }
            searchGrant = (matches, clock.now + .seconds(120))
            return ["matches": .array(matches.map(\.message))]

        case "reveal":
            let databaseID = try identifier(request["database_id"])
            let credentialID = try identifier(request["credential_id"])
            guard let fields = request["fields"]?.array, !fields.isEmpty else {
                throw StrongboxError.invalidRequest
            }
            let names = fields.compactMap(\.string)
            guard names.count == fields.count, Set(names).count == names.count,
                  Set(names).isSubset(of: ["password", "totp"]) else { throw StrongboxError.invalidRequest }

            guard let grant = searchGrant, clock.now < grant.expires,
                  grant.matches.contains(where: {
                      UUID(uuidString: $0.database_id) == UUID(uuidString: databaseID)
                          && UUID(uuidString: $0.credential_id) == UUID(uuidString: credentialID)
                          && Set(names).isSubset(of: $0.available_fields ?? [])
                  }) else { throw StrongboxError.denied }
            searchGrant = nil

            let result = try tool(.reveal, [
                "database_id": .string(databaseID), "credential_id": .string(credentialID),
                "fields": .array(fields),
            ])
            var values: [String: JSONValue] = [:]
            for name in names {
                guard !result.listsUnavailable(name) else { throw StrongboxError.unavailableEntry }
                guard let value = result.revealedValue(name) else { throw StrongboxError.invalidResponse }
                guard !value.isEmpty, !value.hasPrefix("{REF:") else { throw StrongboxError.unavailableEntry }
                values[name] = .string(value)
            }
            return ["values": .object(values)]

        default:
            throw StrongboxError.invalidRequest
        }
    }

    private func search(_ url: String, databaseID: String?) throws -> [MatchList.Match] {
        var arguments: [String: JSONValue] = ["url": .string(url), "limit": .number(20)]
        if let databaseID { arguments["database_id"] = .string(databaseID) }
        let result = try tool(.search, arguments).decoded(as: MatchList.self)
        let requestedVault = databaseID.flatMap(UUID.init(uuidString:))
        guard result.matches.count <= 20, result.matches.allSatisfy({ match in
            guard let vault = UUID(uuidString: match.database_id),
                  UUID(uuidString: match.credential_id) != nil else { return false }
            return requestedVault == nil || vault == requestedVault
        }) else { throw StrongboxError.invalidResponse }
        return result.matches
    }

    private func registrableDomainURL(of components: URLComponents) -> String? {
        guard let host = components.host, let domain = suffixes?.registrableDomain(of: host),
              domain != host.lowercased() else { return nil }
        var parent = URLComponents()
        parent.scheme = components.scheme
        parent.host = domain
        parent.path = "/"
        return parent.string
    }

    private func identifier(_ value: JSONValue?) throws -> String {
        guard let id = value?.string, UUID(uuidString: id) != nil else { throw StrongboxError.invalidRequest }
        return id
    }

    private func tool(_ tool: StrongboxTool, _ arguments: [String: JSONValue] = [:]) throws -> JSONValue {
        if connection == nil { connection = try connect() }
        do {
            return try connection!.tool(tool, arguments: arguments)
        } catch let error as StrongboxError {
            switch error {
            case .timedOut, .unavailable, .invalidResponse, .disconnected:
                connection = nil
                searchGrant = nil
            default:
                break
            }
            throw error
        }
    }
}

func errorReply(_ error: StrongboxError, id: JSONValue? = nil) throws -> Data {
    try JSONEncoder().encode(JSONValue.object(["id": id ?? .null, "error": .string(error.kind)]))
}
