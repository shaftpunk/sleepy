import Foundation

enum SleepWakeFailure: String, Error, Codable, Hashable {
    case authentication, unconfirmed
}

// One in-flight command per sleep. Both side effects are strictly downstream
// of an authoritative confirmation, never a tap or a local estimate.
@MainActor
final class SleepWakeOperation {
    private var inFlight = Set<UUID>()

    func run(
        sleepId: UUID,
        confirm: @MainActor () async throws -> Void,
        stopSound: @MainActor () -> Void,
        dismiss: @MainActor () async -> Void,
        report: @MainActor (SleepWakeFailure) async -> Void
    ) async {
        guard inFlight.insert(sleepId).inserted else { return }
        defer { inFlight.remove(sleepId) }
        do {
            try await confirm()
            stopSound()
            await dismiss()
        } catch {
            await report(error as? SleepWakeFailure ?? .unconfirmed)
        }
    }
}
