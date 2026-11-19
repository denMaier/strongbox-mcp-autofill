// Adapted from StrongboxTunaExtension (MIT, copyright 2026 Denis Maier).
import Foundation

enum StrongboxError: Error {
    case unavailable, untrustedHelper, invalidResponse, timedOut, notPaired, disabled
    case disconnected, denied, locked, unavailableEntry, invalidRequest

    static func toolError(_ text: String) -> Self {
        if text.contains("This MCP host is not paired") { return .notPaired }
        if text.contains("Strongbox MCP access is disabled") { return .disabled }
        if text.contains("database is locked") || text.contains("Call unlock_database") { return .locked }
        return .denied
    }

    var kind: String {
        switch self {
        case .notPaired: return "not_paired"
        case .disabled: return "disabled"
        case .locked: return "locked"
        case .denied: return "denied"
        case .unavailable, .unavailableEntry, .untrustedHelper, .disconnected: return "unavailable"
        case .invalidRequest, .invalidResponse: return "invalid"
        case .timedOut: return "timeout"
        }
    }
}

enum JSONValue: Codable, Sendable {
    case object([String: JSONValue]), array([JSONValue]), string(String), number(Double), bool(Bool), null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { throw StrongboxError.invalidResponse }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    subscript(_ key: String) -> JSONValue? {
        guard case .object(let values) = self else { return nil }
        return values[key]
    }

    var string: String? { if case .string(let value) = self { return value }; return nil }
    var array: [JSONValue]? { if case .array(let value) = self { return value }; return nil }
    var boolean: Bool? { if case .bool(let value) = self { return value }; return nil }
    var number: Double? { if case .number(let value) = self { return value }; return nil }

    func decoded<Value: Decodable>(as type: Value.Type) throws -> Value {
        do { return try JSONDecoder().decode(type, from: JSONEncoder().encode(self)) }
        catch { throw StrongboxError.invalidResponse }
    }
}

extension JSONValue {
    /// `reveal_credential` publishes no output schema, so this accepts the plausible layouts and fails closed.
    func revealedValue(_ name: String) -> String? {
        let root = self["revealed_credential"] ?? self
        let fields = root["fields"]
        return fields?[name]?.string ?? root[name]?.string ?? fields?[name]?["value"]?.string
            ?? fields?.array?.first {
                ($0["name"] ?? $0["field"] ?? $0["key"])?.string == name
            }?["value"]?.string
    }

    func listsUnavailable(_ name: String) -> Bool {
        let root = self["revealed_credential"] ?? self
        return root["unavailable_fields"]?.array?.contains { $0.string == name } ?? false
    }
}

struct DatabaseList: Decodable {
    struct Database: Decodable {
        let database_id: String
        let database_name: String
        let locked: Bool
    }

    let databases: [Database]
}

struct MatchList: Decodable {
    struct Match: Decodable {
        let database_id: String
        let database_name: String
        let credential_id: String
        let title: String?
        let username: String?
        let available_fields: [String]?

        var message: JSONValue {
            .object([
                "database_id": .string(database_id),
                "database_name": .string(database_name),
                "credential_id": .string(credential_id),
                "title": .string(title ?? "Untitled Entry"),
                "username": .string(username ?? ""),
                "available_fields": .array((available_fields ?? []).map(JSONValue.string)),
            ])
        }
    }

    let matches: [Match]
}
