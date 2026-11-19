// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "StrongboxBrowserBridge",
    platforms: [.macOS(.v15)],
    targets: [
        .target(name: "BridgeCore"),
        .executableTarget(name: "strongbox-browser-bridge", dependencies: ["BridgeCore"]),
        .testTarget(name: "BridgeCoreTests", dependencies: ["BridgeCore"]),
    ],
    swiftLanguageModes: [.v5]
)
