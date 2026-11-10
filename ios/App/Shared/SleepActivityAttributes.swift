import Foundation
import ActivityKit

@available(iOS 16.2, *)
struct SleepActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var soundMonitoringActive: Bool
    }
    let sleepId: String
    let babyId: String
    let babyName: String
    let startedAt: Date
    // Presentation deadline, not a sleep end date. Prevents an ended/stale UI
    // counting indefinitely while the system retains it on the Lock Screen.
    let presentationEndsAt: Date
}
