// Adapted from StrongboxTunaExtension (MIT, copyright 2026 Denis Maier).
import Foundation

enum StrongboxTool: String {
    case list = "list_databases", unlock = "unlock_database"
    case search = "find_credentials", reveal = "reveal_credential"
}

protocol MCPTransport {
    func tool(_ tool: StrongboxTool, arguments: [String: JSONValue]) throws -> JSONValue
}

final class MCPConnection: MCPTransport {
    static let protocolVersion = "2025-06-18"
    private let helper: HelperProcess
    private var sequence = 0

    init(installation: StrongboxInstallation) throws {
        helper = try HelperProcess(executable: installation.mcpHelper())
        let result = try request("initialize", parameters: .object([
            "protocolVersion": .string(Self.protocolVersion),
            "capabilities": .object([:]),
            "clientInfo": .object([
                "name": .string("Strongbox Browser Bridge"), "version": .string("1.0.0"),
            ]),
        ]), timeout: 10)
        // A server answers with another version only when it doesn't support this one.
        guard result["protocolVersion"]?.string == Self.protocolVersion else { throw StrongboxError.invalidResponse }
        try send(.object(["jsonrpc": .string("2.0"), "method": .string("notifications/initialized")]))
    }

    func tool(_ tool: StrongboxTool, arguments: [String: JSONValue]) throws -> JSONValue {
        let result = try request("tools/call", parameters: .object([
            "name": .string(tool.rawValue), "arguments": .object(arguments),
        ]), timeout: tool == .unlock || tool == .reveal ? 90 : 15)
        if result["isError"]?.boolean == true {
            let text = result["content"]?.array?.compactMap { $0["text"]?.string }.joined(separator: " ") ?? ""
            throw StrongboxError.toolError(text)
        }
        if let value = result["structuredContent"] { return value }
        for content in result["content"]?.array ?? [] {
            if content["type"]?.string == "text", let text = content["text"]?.string,
               let value = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) {
                return value
            }
        }
        throw StrongboxError.invalidResponse
    }

    private func send(_ value: JSONValue) throws {
        var data = try JSONEncoder().encode(value)
        data.append(10)
        try helper.write(data)
    }

    private func request(_ method: String, parameters: JSONValue, timeout: TimeInterval) throws -> JSONValue {
        sequence += 1
        try send(.object([
            "jsonrpc": .string("2.0"), "id": .number(Double(sequence)),
            "method": .string(method), "params": parameters,
        ]))
        let deadline = Date().addingTimeInterval(timeout)
        while true {
            let line = try helper.readLine(deadline: deadline)
            guard !line.isEmpty else { continue }
            guard let message = try? JSONDecoder().decode(JSONValue.self, from: line) else {
                throw StrongboxError.invalidResponse
            }
            if message["method"] != nil {
                if let identifier = message["id"] {
                    try send(.object([
                        "jsonrpc": .string("2.0"), "id": identifier,
                        "error": .object(["code": .number(-32601), "message": .string("Unsupported request")]),
                    ]))
                }
                continue
            }
            guard message["id"]?.number == Double(sequence) else { continue }
            guard message["error"] == nil, let result = message["result"] else {
                throw StrongboxError.denied
            }
            return result
        }
    }
}
