import Foundation

enum Framing {
    static let requestLimit = 64 * 1024
    static let responseLimit = 1024 * 1024

    enum ReadError: Error { case partial, oversize }

    static func read(from input: FileHandle) throws -> Data? {
        let header = try readBytes(4, from: input)
        if header.isEmpty { return nil }
        guard header.count == 4 else { throw ReadError.partial }
        let length = Int(header.withUnsafeBytes { $0.loadUnaligned(as: UInt32.self) })
        guard length <= requestLimit else { throw ReadError.oversize }
        let body = try readBytes(length, from: input)
        guard body.count == length else { throw ReadError.partial }
        return body
    }

    private static func readBytes(_ count: Int, from input: FileHandle) throws -> Data {
        var data = Data()
        while data.count < count {
            guard let chunk = try input.read(upToCount: count - data.count), !chunk.isEmpty else { break }
            data.append(chunk)
        }
        return data
    }

    static func write(_ body: Data, to output: FileHandle) throws {
        guard body.count <= responseLimit else { throw StrongboxError.invalidResponse }
        var length = UInt32(body.count)
        try output.write(contentsOf: Data(bytes: &length, count: 4) + body)
    }
}
