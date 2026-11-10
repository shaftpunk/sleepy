// swift-tools-version: 5.9
import PackageDescription

let package = Package(name: "NativeSoundCore", products: [.library(name: "NativeSoundCore", targets: ["NativeSoundCore"])],
    targets: [.target(name: "NativeSoundCore"),
              .testTarget(name: "NativeSoundCoreTests", dependencies: ["NativeSoundCore"], resources: [.process("Fixtures")])])
