import Capacitor
import UIKit

@objc(SleepyFeedbackPlugin)
public class SleepyFeedbackPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SleepyFeedbackPlugin"
    public let jsName = "SleepyFeedback"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "selection", returnType: CAPPluginReturnPromise)
    ]
    @objc public func selection(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UISelectionFeedbackGenerator().selectionChanged()
            call.resolve()
        }
    }
}
import UserNotifications

@objc(SleepyPredictionReminderPlugin)
public class SleepyPredictionReminderPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "SleepyPredictionReminderPlugin"
    public let jsName = "SleepyPredictionReminder"
    private let requestID = "sleepy.next-onset"
    public let pluginMethods = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)
    ]
    public override func load() {
        bridge?.notificationRouter.localNotificationHandler = self
    }
    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        return notification.request.identifier == requestID ? [.banner, .sound] : []
    }
    public func didReceive(response: UNNotificationResponse) {}
    @objc public func cancel(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [requestID])
        call.resolve()
    }
    @objc public func schedule(_ call: CAPPluginCall) {
        guard let at = call.getDouble("at"), let title = call.getString("title"),
              let body = call.getString("body") else { call.reject("Invalid reminder"); return }
        let delay = at / 1000 - Date().timeIntervalSince1970
        guard delay > 0 else { cancel(call); return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: requestID, content: content, trigger: trigger)) { error in
            if let error = error { call.reject(error.localizedDescription) } else { call.resolve() }
        }
    }
}
