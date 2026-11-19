import Foundation

struct PublicSuffixList {
    private var rules: Set<String> = []
    private var wildcards: Set<String> = []
    private var exceptions: Set<String> = []

    init(_ text: String) {
        for line in text.split(whereSeparator: \.isNewline) {
            guard let rule = line.split(whereSeparator: \.isWhitespace).first, !rule.hasPrefix("//") else { continue }
            if rule.hasPrefix("*.") {
                wildcards.insert(String(rule.dropFirst(2)))
            } else if rule.hasPrefix("!") {
                exceptions.insert(String(rule.dropFirst()))
            } else {
                rules.insert(String(rule))
            }
        }
    }

    // The domain one label below the host's public suffix. Undefined unless a listed
    // rule covers the host, so unknown suffixes and IP addresses never widen a search.
    func registrableDomain(of host: String) -> String? {
        let labels = host.lowercased().split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        // Listed internationalized suffixes are in Unicode, so punycode can't be judged here.
        guard labels.allSatisfy({ !$0.isEmpty && !$0.hasPrefix("xn--") }) else { return nil }
        func joined(from index: Int) -> String { labels[index...].joined(separator: ".") }

        // Shortest index first, so the longest rule wins.
        for index in labels.indices {
            let candidate = joined(from: index)
            if exceptions.contains(candidate) { return candidate }
            let wildcard = index + 1 < labels.count && wildcards.contains(joined(from: index + 1))
            if rules.contains(candidate) || wildcard {
                return index > 0 ? joined(from: index - 1) : nil
            }
        }
        return nil
    }
}
