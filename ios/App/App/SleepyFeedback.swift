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
