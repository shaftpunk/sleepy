import AppIntents
import Foundation

@available(iOS 17.0, *)
struct WakeSleepIntent: LiveActivityIntent {
    static var title: LocalizedStringResource { "wake_sleep" }
    static var isDiscoverable: Bool { false }
    static var openAppWhenRun: Bool { false }
    static var authenticationPolicy: IntentAuthenticationPolicy { .requiresLocalDeviceAuthentication }

    @Parameter(title: "Sleep ID") var sleepId: String
    @Parameter(title: "Live Activity ID") var activityID: String

    init() {}
    init(sleepId: String, activityID: String) {
        self.sleepId = sleepId
        self.activityID = activityID
    }

    func perform() async throws -> some IntentResult {
        #if !SLEEPY_WIDGET_EXTENSION
        await SleepWakeCommand.run(sleepId: sleepId, activityID: activityID, endedAt: Date())
        #endif
        // LiveActivityIntent executes in App. The extension has no write path.
        return .result()
    }
}
