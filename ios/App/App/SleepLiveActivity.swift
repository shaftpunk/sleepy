import ActivityKit
import Capacitor
import UIKit
import os

@available(iOS 16.2, *)
@MainActor
final class SleepLiveActivityCoordinator {
    static let shared = SleepLiveActivityCoordinator()
    private let log = Logger(subsystem: "no.strandeconsulting.sleepy", category: "LiveActivity")
    private let defaults = UserDefaults.standard
    private var sound: [String: Bool] = [:]
    private var queued: Task<Void, Never>?
    // Serialize bridge reconciliation and native sound transitions across await
    // points, so an older update cannot overtake Stop/account cleanup.
    func enqueue(_ operation: @escaping @MainActor () async -> Void) async {
        let previous = queued
        let next = Task { @MainActor in await previous?.value; await operation() }
        queued = next
        await next.value
    }
    private var attempted: [String: Double] {
        get { defaults.dictionary(forKey: "SleepyLiveActivity.attempted.v1") as? [String: Double] ?? [:] }
        set { defaults.set(newValue, forKey: "SleepyLiveActivity.attempted.v1") }
    }
    struct Sleep {
        let sleepId: String, babyId: String, babyName: String
        let startedAt: Date
        init?(_ value: [String: Any]) {
            guard let id = value["sleepId"] as? String, UUID(uuidString: id) != nil,
                  let baby = value["babyId"] as? String, UUID(uuidString: baby) != nil,
                  let name = value["babyName"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 200,
                  let date = value["startedAt"] as? String else { return nil }
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            var parsed = formatter.date(from: date)
            if parsed == nil { formatter.formatOptions = [.withInternetDateTime]; parsed = formatter.date(from: date) }
            guard let start = parsed, start <= Date() else { return nil }
            sleepId = id; babyId = baby; babyName = name; startedAt = start
        }
    }
    func reconcile(ownerId: String, sleeps: [Sleep]) async {
        if let oldOwner = defaults.string(forKey: "SleepyLiveActivity.owner.v1"), oldOwner != ownerId { await endAll() }
        defaults.set(ownerId, forKey: "SleepyLiveActivity.owner.v1")
        let ids = Set(sleeps.map(\.sleepId))
        var ledger = attempted.filter { ids.contains($0.key) }
        let activities = Activity<SleepActivityAttributes>.activities
        // Recover suppression even if this app version didn't write a ledger.
        for activity in activities where ids.contains(activity.attributes.sleepId) {
            ledger[activity.attributes.sleepId] = ledger[activity.attributes.sleepId] ?? activity.attributes.presentationEndsAt.addingTimeInterval(-SleepActivityPolicy.maximumLifetime).timeIntervalSince1970
        }
        attempted = ledger
        let plan = SleepActivityPolicy.plan(active: ids, existing: activities.map {
            .init(id: $0.id, sleepId: $0.attributes.sleepId,
                  ongoing: ($0.activityState == .active || $0.activityState == .stale) && $0.attributes.presentationEndsAt > Date())
        }, attempted: Set(ledger.keys), mayRequest: UIApplication.shared.applicationState == .active && ActivityAuthorizationInfo().areActivitiesEnabled)
        for activity in activities where plan.end.contains(activity.id) { await finish(activity) }
        for sleep in sleeps {
            if let existing = Activity<SleepActivityAttributes>.activities.first(where: { $0.attributes.sleepId == sleep.sleepId && !plan.end.contains($0.id) }) {
                // Immutable corrected timestamps must not leave a misleading timer.
                if abs(existing.attributes.startedAt.timeIntervalSince(sleep.startedAt)) > 1 || existing.attributes.babyId != sleep.babyId {
                    await finish(existing) // Retain ledger: no silent renewal/replacement.
                } else { await update(sleepId: sleep.sleepId, active: sound[sleep.sleepId] ?? false) }
            } else if plan.request.contains(sleep.sleepId) { request(sleep) }
        }
    }
    func start(ownerId: String, sleep: Sleep) async {
        if let oldOwner = defaults.string(forKey: "SleepyLiveActivity.owner.v1"), oldOwner != ownerId { await endAll() }
        defaults.set(ownerId, forKey: "SleepyLiveActivity.owner.v1")
        if Activity<SleepActivityAttributes>.activities.contains(where: { $0.attributes.sleepId == sleep.sleepId }) {
            await update(sleepId: sleep.sleepId, active: sound[sleep.sleepId] ?? false); return
        }
        guard attempted[sleep.sleepId] == nil else { return }
        request(sleep)
    }
    private func request(_ sleep: Sleep) {
        guard UIApplication.shared.applicationState == .active, ActivityAuthorizationInfo().areActivitiesEnabled else {
            log.info("Live Activity unavailable or not permitted in foreground"); return
        }
        guard attempted.count < 64 else { log.info("Live Activity presentation history limit reached"); return }
        let expires = Date().addingTimeInterval(SleepActivityPolicy.maximumLifetime)
        let attributes = SleepActivityAttributes(sleepId: sleep.sleepId, babyId: sleep.babyId, babyName: sleep.babyName,
                                                startedAt: sleep.startedAt, presentationEndsAt: expires)
        do {
            _ = try Activity.request(attributes: attributes,
                content: ActivityContent(state: SleepActivityAttributes.ContentState(soundMonitoringActive: sound[sleep.sleepId] ?? false), staleDate: expires), pushType: nil)
            var ledger = attempted; ledger[sleep.sleepId] = Date().timeIntervalSince1970; attempted = ledger
            log.info("Live Activity started")
        } catch { log.info("Live Activity request unavailable; sleep data unchanged") }
    }
    // Called only for native capture transitions, never for individual buffers.
    func resetSoundStatus() async {
        sound.removeAll()
        for id in Set(Activity<SleepActivityAttributes>.activities.map({ $0.attributes.sleepId })) {
            await update(sleepId: id, active: false)
        }
    }
    func soundChanged(sleepId: String, running: Bool) async {
        if running { sound[sleepId] = true } else { sound.removeValue(forKey: sleepId) }
        await update(sleepId: sleepId, active: running)
    }
    func update(sleepId: String, active: Bool) async {
        for activity in Activity<SleepActivityAttributes>.activities where activity.attributes.sleepId == sleepId {
            guard activity.activityState == .active || activity.activityState == .stale else { continue }
            guard activity.attributes.presentationEndsAt > Date() else { await finish(activity); continue }
            let state = SleepActivityAttributes.ContentState(soundMonitoringActive: active)
            if activity.content.state != state { await activity.update(ActivityContent(state: state, staleDate: activity.attributes.presentationEndsAt)) }
        }
    }
    func end(sleepId: String) async {
        for activity in Activity<SleepActivityAttributes>.activities where activity.attributes.sleepId == sleepId { await finish(activity) }
        var ledger = attempted; ledger.removeValue(forKey: sleepId); attempted = ledger
    }
    func endAll() async {
        for activity in Activity<SleepActivityAttributes>.activities { await finish(activity) }
        attempted = [:]; defaults.removeObject(forKey: "SleepyLiveActivity.owner.v1")
        // Capture ownership is managed by SoundMeter, not ActivityKit.
    }
    private func finish(_ activity: Activity<SleepActivityAttributes>) async {
        await activity.end(ActivityContent(state: .init(soundMonitoringActive: false), staleDate: Date()), dismissalPolicy: .immediate)
    }
}

@objc(SleepyLiveActivityPlugin)
public class SleepyLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SleepyLiveActivityPlugin"
    public let jsName = "SleepyLiveActivity"
    public let pluginMethods = ["startSleep", "updateSleep", "endSleep", "reconcile", "endAll"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private var pending: Task<Void, Never>?
    private func perform(_ call: CAPPluginCall, operation: @escaping @MainActor () async -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.resolve(); return }
            let previous = self.pending
            self.pending = Task { @MainActor in
                await previous?.value
                if #available(iOS 16.2, *) { await SleepLiveActivityCoordinator.shared.enqueue(operation) }
                call.resolve()
            }
        }
    }
    @objc public func reconcile(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *) {
                guard let owner = call.getString("ownerId"), UUID(uuidString: owner) != nil,
                      let rows = call.getArray("sleeps", [String: Any].self), rows.count <= 64 else { return }
                let sleeps = rows.compactMap(SleepLiveActivityCoordinator.Sleep.init)
                guard sleeps.count == rows.count, Set(sleeps.map(\.sleepId)).count == sleeps.count else { return }
                await SleepLiveActivityCoordinator.shared.reconcile(ownerId: owner, sleeps: sleeps)
            }
        }
    }
    @objc public func startSleep(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *), let owner = call.getString("ownerId"), UUID(uuidString: owner) != nil,
               let options = call.options as? [String: Any],
               let sleep = SleepLiveActivityCoordinator.Sleep(options) { await SleepLiveActivityCoordinator.shared.start(ownerId: owner, sleep: sleep) }
        }
    }
    @objc public func updateSleep(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *), let id = call.getString("sleepId"), let active = call.getBool("soundMonitoringActive") {
                await SleepLiveActivityCoordinator.shared.update(sleepId: id, active: active)
            }
        }
    }
    @objc public func endSleep(_ call: CAPPluginCall) {
        perform(call) { if #available(iOS 16.2, *), let id = call.getString("sleepId") { await SleepLiveActivityCoordinator.shared.end(sleepId: id) } }
    }
    @objc public func endAll(_ call: CAPPluginCall) {
        perform(call) { if #available(iOS 16.2, *) { await SleepLiveActivityCoordinator.shared.endAll() } }
    }
}
