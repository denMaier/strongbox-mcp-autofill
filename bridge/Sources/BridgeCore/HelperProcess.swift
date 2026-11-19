// Adapted from StrongboxTunaExtension (MIT, copyright 2026 Denis Maier).
import Darwin
import Foundation
import Security

public struct StrongboxInstallation: Sendable {
    public let applicationURL: URL

    public init(applicationURL: URL? = nil) {
        self.applicationURL = applicationURL ?? [
            "/Applications/Strongbox.app", "/Applications/Setapp/Strongbox.app",
        ].map { URL(fileURLWithPath: $0) }.first {
            FileManager.default.fileExists(atPath: $0.path)
        } ?? URL(fileURLWithPath: "/Applications/Strongbox.app")
    }

    func mcpHelper() throws -> URL {
        let url = applicationURL.appendingPathComponent("Contents/MacOS/strongbox-mcp")
        guard FileManager.default.isExecutableFile(atPath: url.path) else { throw StrongboxError.unavailable }
        guard strongboxIdentifier(of: url) == "com.markmcguill.strongbox.mcp" else {
            throw StrongboxError.untrustedHelper
        }
        return url
    }

    // Validating the app's signature also covers its resources, including this file.
    func publicSuffixList() -> PublicSuffixList? {
        let url = applicationURL.appendingPathComponent("Contents/Resources/public_suffix_list.dat")
        guard strongboxIdentifier(of: applicationURL) != nil,
              let data = try? Data(contentsOf: url), data.count <= 1024 * 1024,
              let text = String(data: data, encoding: .utf8) else { return nil }
        return PublicSuffixList(text)
    }

    // The signing identifier of valid code from Strongbox's team, otherwise nil.
    private func strongboxIdentifier(of url: URL) -> String? {
        var code: SecStaticCode?
        var requirement: SecRequirement?
        var information: CFDictionary?
        let rule = "anchor apple generic"
        guard SecStaticCodeCreateWithPath(url as CFURL, [], &code) == errSecSuccess,
              SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
              let code, let requirement,
              SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess,
              SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &information) == errSecSuccess,
              let metadata = information as? [String: Any],
              metadata[kSecCodeInfoTeamIdentifier as String] as? String == "4326J8XDF2" else {
            return nil
        }
        return metadata[kSecCodeInfoIdentifier as String] as? String
    }
}

final class HelperProcess {
    let process = Process()
    private let input = Pipe()
    private let output = Pipe()
    private var buffer = Data()
    private let responseLimit = 8 * 1024 * 1024

    init(executable: URL) throws {
        process.executableURL = executable
        process.standardInput = input
        process.standardOutput = output
        process.standardError = FileHandle.nullDevice
        do { try process.run() }
        catch { throw StrongboxError.unavailable }
        guard fcntl(input.fileHandleForWriting.fileDescriptor, F_SETNOSIGPIPE, 1) != -1 else {
            process.terminate()
            throw StrongboxError.unavailable
        }
    }

    deinit {
        if process.isRunning {
            process.terminate()
            let child = process
            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                if child.isRunning { Darwin.kill(child.processIdentifier, SIGKILL) }
            }
        }
        try? input.fileHandleForWriting.close()
        try? output.fileHandleForReading.close()
    }

    func write(_ data: Data) throws {
        guard process.isRunning else { throw StrongboxError.disconnected }
        do { try input.fileHandleForWriting.write(contentsOf: data) }
        catch { throw StrongboxError.disconnected }
    }

    func readLine(deadline: Date) throws -> Data {
        // Only new bytes are searched, so a long line costs linear time.
        var searched = buffer.startIndex
        while true {
            if let newline = buffer[searched...].firstIndex(of: 10) {
                let line = Data(buffer[..<newline])
                buffer = Data(buffer[buffer.index(after: newline)...])
                return line
            }
            searched = buffer.endIndex
            try readMore(deadline: deadline)
        }
    }

    private func readMore(deadline: Date) throws {
        while true {
            let remaining = deadline.timeIntervalSinceNow
            guard remaining > 0 else { throw StrongboxError.timedOut }
            var descriptor = pollfd(fd: output.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0)
            let ready = Darwin.poll(&descriptor, 1, Int32(min(remaining * 1000, 90_000)))
            if ready < 0 && errno == EINTR { continue }
            guard ready > 0 else { throw ready == 0 ? StrongboxError.timedOut : StrongboxError.unavailable }
            var bytes = [UInt8](repeating: 0, count: 32_768)
            let count = Darwin.read(descriptor.fd, &bytes, bytes.count)
            if count < 0 && errno == EINTR { continue }
            guard count > 0 else { throw StrongboxError.disconnected }
            guard buffer.count + count <= responseLimit else { throw StrongboxError.invalidResponse }
            buffer.append(contentsOf: bytes.prefix(count))
            return
        }
    }
}
