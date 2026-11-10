import Foundation

public struct SoundSession: Codable, Equatable {
    public let runId: String
    public let userId: String
    public let babyId: String
    public let sleepId: String
    public let threshold: Double
    public init(runId: String, userId: String, babyId: String, sleepId: String, threshold: Double) {
        self.runId = runId; self.userId = userId; self.babyId = babyId; self.sleepId = sleepId; self.threshold = threshold
    }
}
public struct NativeSoundEvent: Codable, Equatable {
    public let id: String
    public let session: SoundSession
    public let observation: SoundObservation
    public init(id: String = UUID().uuidString.lowercased(), session: SoundSession, observation: SoundObservation) {
        self.id = id; self.session = session; self.observation = observation
    }
}
// Only finalized event metadata. No samples, buffers, files of audio, credentials
// or recorder state are accepted by this type. All calls are serialized natively.
public final class NativeSoundEventQueue {
    public static let capacity = 256
    public private(set) var events: [NativeSoundEvent]
    private let url: URL?
    public enum Failure: Error { case full, invalidArchive }
    public init(url: URL? = nil) throws {
        self.url = url
        if let url = url, FileManager.default.fileExists(atPath: url.path) {
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard ((attributes[.size] as? NSNumber)?.intValue ?? Int.max) <= 1048576 else { throw Failure.invalidArchive }
            events = try JSONDecoder().decode([NativeSoundEvent].self, from: Data(contentsOf: url))
            guard events.count <= Self.capacity else { throw Failure.invalidArchive }
        } else { events = [] }
    }
    public func append(_ event: NativeSoundEvent) throws {
        if events.contains(where: { $0.id == event.id }) { return }
        guard events.count < Self.capacity else { throw Failure.full }
        events.append(event)
        do { try save() } catch { events.removeLast(); throw error }
    }
    public func acknowledge(userId: String, ids: Set<String>) throws {
        let previous = events
        events.removeAll { $0.session.userId == userId && ids.contains($0.id) }
        do { try save() } catch { events = previous; throw error }
    }
    private func save() throws {
        if let url = url {
            try JSONEncoder().encode(events).write(to: url, options: .atomic)
            #if os(iOS)
            try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
            #endif
        }
    }
}
