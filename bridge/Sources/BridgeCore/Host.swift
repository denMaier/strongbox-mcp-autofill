import Darwin
import Foundation
import Security

public enum Host {
    struct Browser {
        let identifier: String
        let team: String
        let origin: String

        var requirement: SecRequirement? {
            let text = #"anchor apple generic and identifier "\#(identifier)" and certificate leaf[subject.OU] = "\#(team)""#
            var requirement: SecRequirement?
            return SecRequirementCreateWithString(text as CFString, [], &requirement) == errSecSuccess ? requirement : nil
        }
    }

    // Chromium browsers derive the extension's ID from the manifest key. Search ignores
    // the key and derives it from the folder it was loaded from, /Library/StrongboxMCPAutoFill.
    static let keyedOrigin = "chrome-extension://lkgpmndbggpfaeenpehmblmbgmkbcbnk/"
    static let folderOrigin = "chrome-extension://nmoagjmbdnebfnhachgpglincjficfkg/"

    static let browsers = [
        Browser(identifier: "net.imput.helium", team: "S4Q33XPHB4", origin: keyedOrigin),
        Browser(identifier: "com.google.Chrome", team: "EQHXZ8M8AV", origin: keyedOrigin),
        Browser(identifier: "com.officecommun.search", team: "7BYKA895MC", origin: folderOrigin),
    ]

    // The browsers that may launch the bridge for the origin they passed.
    static func browsers(for arguments: [String]) -> [Browser] {
        guard arguments.count > 1 else { return [] }
        return browsers.filter { $0.origin == arguments[1] }
    }

    private static func verifiedParent(among browsers: [Browser]) -> Bool {
        let pid = getppid()
        let attributes = [kSecGuestAttributePid as String: NSNumber(value: pid)] as CFDictionary
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &code) == errSecSuccess, let parent = code else {
            return false
        }
        return browsers.contains { browser in
            browser.requirement.map { SecCodeCheckValidity(parent, [], $0) == errSecSuccess } == true
        } && getppid() == pid
    }

    public static func run(arguments: [String]) -> Int32 {
        guard verifiedParent(among: browsers(for: arguments)) else {
            try? FileHandle.standardError.write(contentsOf: Data("denied\n".utf8))
            return EXIT_FAILURE
        }

        let input = FileHandle.standardInput
        let output = FileHandle.standardOutput
        guard fcntl(output.fileDescriptor, F_SETNOSIGPIPE, 1) != -1 else { return EXIT_FAILURE }
        let installation = StrongboxInstallation()
        let bridge = Bridge(connect: { try MCPConnection(installation: installation) },
                            suffixes: { installation.publicSuffixList() })
        do {
            while let body = try Framing.read(from: input) {
                try Framing.write(bridge.reply(to: body), to: output)
            }
            return EXIT_SUCCESS
        } catch is Framing.ReadError {
            // An oversize or truncated frame leaves no reliable request boundary.
            try? Framing.write(errorReply(.invalidRequest), to: output)
            return EXIT_FAILURE
        } catch {
            return EXIT_FAILURE
        }
    }
}
