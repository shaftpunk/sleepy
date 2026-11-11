import Foundation
import ActivityKit

enum ActiveSleepClassification: String, Codable, Hashable {
    case shortSleepLike = "SHORT_SLEEP_LIKE"
    case longSleepLike = "LONG_SLEEP_LIKE"
    case uncertain = "UNCERTAIN"
}

@available(iOS 16.2, *)
struct SleepActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var soundMonitoringActive: Bool
        var estimatedWakeTime: Date? = nil
        var wakeFailure: SleepWakeFailure? = nil
        var classification: ActiveSleepClassification? = nil

        // Activities from the previous app version have no classification key.
        var presentationClassification: ActiveSleepClassification {
            classification ?? (estimatedWakeTime == nil ? .uncertain : .shortSleepLike)
        }
    }
    let sleepId: String
    let babyId: String
    let babyName: String
    let startedAt: Date
    // Presentation deadline, not a sleep end date. Prevents an ended/stale UI
    // counting indefinitely while the system retains it on the Lock Screen.
    let presentationEndsAt: Date
}
