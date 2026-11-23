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
    private var tokenTasks: [String: Task<Void, Never>] = [:]
    private var stateTasks: [String: Task<Void, Never>] = [:]
    private var tokens: [String: [String: Any]] = [:]
    var tokenChanged: (([String: Any]) -> Void)?
    private var queued: Task<Void, Never>?
    // Keep handles while this process lives, including system-ended cards that
    // Activity.activities may no longer enumerate but iOS still retains.
    private var retained: [String: Activity<SleepActivityAttributes>] = [:]
    private var contextBabies = Set<String>()
    private var managed: [Activity<SleepActivityAttributes>] {
        for activity in Activity<SleepActivityAttributes>.activities { retained[activity.id] = activity }
        retained = retained.filter { $0.value.activityState != .dismissed }
        return Array(retained.values)
    }
    private var enabled: Bool { defaults.object(forKey: "SleepyLiveActivity.enabled.v1") as? Bool ?? true }
    func setEnabled(_ value: Bool) async {
        defaults.set(value, forKey: "SleepyLiveActivity.enabled.v1")
        if !value { await endAll() }
    }
    var ownerID: UUID? {
        defaults.string(forKey: "SleepyLiveActivity.owner.v1").flatMap(UUID.init(uuidString:))
    }
    func setContext(ownerId: String, babyIds: Set<String>) async {
        if ownerID != UUID(uuidString: ownerId) { await endAll() }
        contextBabies = babyIds
        defaults.set(ownerId, forKey: "SleepyLiveActivity.owner.v1")
        for activity in managed where !babyIds.contains(activity.attributes.babyId) {
            await finish(activity)
            var ledger = attempted; ledger.removeValue(forKey: activity.attributes.sleepId); attempted = ledger
        }
        await recoverForeground()
    }
    func reconcileBaby(ownerId: String, babyId: String, activeSleepId: String?) async {
        guard ownerID == UUID(uuidString: ownerId) else { return }
        for activity in managed where activity.attributes.babyId == babyId && activity.attributes.sleepId != activeSleepId {
            await finish(activity)
        }
        // An authoritative empty snapshot for the sole selected baby completes
        // suppression cleanup, including a legitimate later Undo/resume of it.
        if activeSleepId == nil && contextBabies == Set([babyId]) { attempted = [:] }
    }
    func recoverForeground() async {
        for activity in managed where activity.activityState == .ended || activity.attributes.presentationEndsAt <= Date() {
            await finish(activity)
        }
        for activity in managed { observeToken(activity) }
    }
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
    nonisolated static func parseDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
    struct Sleep {
        let sleepId: String, babyId: String, babyName: String
        let startedAt: Date
        let estimatedWakeTime: Date?
        let classification: ActiveSleepClassification
        init?(_ value: [String: Any]) {
            guard let id = value["sleepId"] as? String, UUID(uuidString: id) != nil,
                  let baby = value["babyId"] as? String, UUID(uuidString: baby) != nil,
                  let name = value["babyName"] as? String, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, name.count <= 200,
                  let date = value["startedAt"] as? String else { return nil }
            guard let start = SleepLiveActivityCoordinator.parseDate(date), start <= Date() else { return nil }
            sleepId = id; babyId = baby; babyName = name; startedAt = start
            let estimate = (value["estimatedWakeTime"] as? String).flatMap(SleepLiveActivityCoordinator.parseDate)
            classification = (value["classification"] as? String).flatMap(ActiveSleepClassification.init(rawValue:))
                ?? (estimate == nil ? .uncertain : .shortSleepLike)
            if classification == .shortSleepLike, let estimate, (60...43200).contains(estimate.timeIntervalSince(start)) {
                estimatedWakeTime = estimate
            } else { estimatedWakeTime = nil }
        }
    }
    func reconcile(ownerId: String, sleeps: [Sleep]) async {
        guard enabled else { await endAll(); return }
        if let oldOwner = defaults.string(forKey: "SleepyLiveActivity.owner.v1"), oldOwner != ownerId { await endAll() }
        defaults.set(ownerId, forKey: "SleepyLiveActivity.owner.v1")
        let ids = Set(sleeps.map(\.sleepId))
        var ledger = attempted.filter { ids.contains($0.key) }
        let activities = managed
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
                } else { await update(sleepId: sleep.sleepId, active: sound[sleep.sleepId] ?? false, sleep: sleep) }
            } else if plan.request.contains(sleep.sleepId) { request(sleep) }
        }
    }
    func start(ownerId: String, sleep: Sleep) async {
        guard enabled else { return }
        if let oldOwner = defaults.string(forKey: "SleepyLiveActivity.owner.v1"), oldOwner != ownerId { await endAll() }
        defaults.set(ownerId, forKey: "SleepyLiveActivity.owner.v1")
        if Activity<SleepActivityAttributes>.activities.contains(where: { $0.attributes.sleepId == sleep.sleepId }) {
            await update(sleepId: sleep.sleepId, active: sound[sleep.sleepId] ?? false, sleep: sleep); return
        }
        guard attempted[sleep.sleepId] == nil else { return }
        request(sleep)
    }
    private func request(_ sleep: Sleep) {
        guard enabled else { return }
        guard UIApplication.shared.applicationState == .active, ActivityAuthorizationInfo().areActivitiesEnabled else {
            log.info("Live Activity unavailable or not permitted in foreground"); return
        }
        guard attempted.count < 64 else { log.info("Live Activity presentation history limit reached"); return }
        let expires = Date().addingTimeInterval(SleepActivityPolicy.maximumLifetime)
        let attributes = SleepActivityAttributes(sleepId: sleep.sleepId, babyId: sleep.babyId, babyName: sleep.babyName,
                                                startedAt: sleep.startedAt, presentationEndsAt: expires)
        do {
            let content = ActivityContent(state: SleepActivityAttributes.ContentState(soundMonitoringActive: sound[sleep.sleepId] ?? false,
                estimatedWakeTime: sleep.estimatedWakeTime, classification: sleep.classification), staleDate: expires)
            let activity: Activity<SleepActivityAttributes>
            do {
                activity = try Activity.request(attributes: attributes, content: content, pushType: .token)
            } catch {
                // Keep local presentation available if push-enabled creation fails.
                log.notice("ActivityKit token request failed; trying local presentation")
                activity = try Activity.request(attributes: attributes, content: content, pushType: nil)
            }
            retained[activity.id] = activity
            observeToken(activity)
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
    func update(sleepId: String, active: Bool, sleep: Sleep? = nil) async {
        for activity in managed where activity.attributes.sleepId == sleepId {
            guard activity.activityState == .active || activity.activityState == .stale else { continue }
            guard activity.attributes.presentationEndsAt > Date() else { await finish(activity); continue }
            var state = activity.content.state
            state.soundMonitoringActive = active
            if let sleep {
                state.estimatedWakeTime = sleep.estimatedWakeTime
                state.classification = sleep.classification
                state.wakeFailure = nil // A fresh authoritative active snapshot recovered presentation.
            }
            if activity.content.state != state { await activity.update(ActivityContent(state: state, staleDate: activity.attributes.presentationEndsAt)) }
        }
    }
    func updatePresentation(ownerId: String, sleep: Sleep) async {
        guard let expectedOwner = UUID(uuidString: ownerId), ownerID == expectedOwner else { return }
        for activity in Activity<SleepActivityAttributes>.activities where activity.attributes.sleepId == sleep.sleepId {
            guard activity.activityState == .active, activity.attributes.presentationEndsAt > Date(),
                  activity.attributes.babyId == sleep.babyId,
                  abs(activity.attributes.startedAt.timeIntervalSince(sleep.startedAt)) < 1 else { continue }
            var state = activity.content.state
            state.classification = sleep.classification
            state.estimatedWakeTime = sleep.estimatedWakeTime
            if state != activity.content.state {
                await activity.update(ActivityContent(state: state, staleDate: activity.attributes.presentationEndsAt))
            }
        }
    }
    func showWakeFailure(activityID: String, failure: SleepWakeFailure) async {
        guard let activity = Activity<SleepActivityAttributes>.activities.first(where: { $0.id == activityID }),
              activity.activityState == .active else { return }
        var state = activity.content.state
        guard state.wakeFailure != failure else { return }
        state.wakeFailure = failure
        await activity.update(ActivityContent(state: state, staleDate: activity.attributes.presentationEndsAt))
    }
    func finishConfirmedWake(sleepId: String) async {
        // Keep suppression until the next authoritative snapshot. An older
        // in-flight read must not recreate the just-ended Live Activity.
        var ledger = attempted
        ledger[sleepId] = Date().timeIntervalSince1970
        attempted = ledger
        for activity in managed where activity.attributes.sleepId == sleepId {
            await finish(activity)
        }
    }
    func end(sleepId: String) async {
        await finishConfirmedWake(sleepId: sleepId)
    }
    func endAll() async {
        for activity in managed { await finish(activity) }
        attempted = [:]; defaults.removeObject(forKey: "SleepyLiveActivity.owner.v1")
        contextBabies = []
        // Capture ownership is managed by SoundMeter, not ActivityKit.
    }
    private func observeToken(_ activity: Activity<SleepActivityAttributes>) {
        guard tokenTasks[activity.id] == nil, ownerID != nil, enabled,
              activity.activityState == .active || activity.activityState == .stale,
              activity.attributes.presentationEndsAt > Date() else { return }
        let currentToken = activity.pushToken
        log.notice("Activity token observer started activityId=\(activity.id, privacy: .public) sleepId=\(activity.attributes.sleepId, privacy: .public) tokenPresent=\(currentToken != nil) tokenBytes=\(currentToken?.count ?? 0)")
        if let token = currentToken { recordToken(token, for: activity) }
        tokenTasks[activity.id] = Task { [weak self] in
            for await token in activity.pushTokenUpdates {
                guard !Task.isCancelled else { return }
                self?.recordToken(token, for: activity)
            }
        }
        stateTasks[activity.id] = Task { [weak self] in
            for await state in activity.activityStateUpdates {
                guard !Task.isCancelled else { return }
                if state == .ended || state == .dismissed {
                    self?.removeToken(activity.id)
                    return
                }
            }
        }
    }
    private func recordToken(_ bytes: Data, for activity: Activity<SleepActivityAttributes>) {
        guard let owner = ownerID, activity.activityState == .active || activity.activityState == .stale,
              activity.attributes.presentationEndsAt > Date() else { return }
        let token = bytes.map { String(format: "%02x", $0) }.joined()
        guard (tokens[activity.id]?["token"] as? String) != token else { return }
        let key = "SleepyLiveActivity.tokenRevision.v1"
        let revision = defaults.integer(forKey: key) + 1
        defaults.set(revision, forKey: key)
        // The checked-in provisioning entitlement is production. Sandbox-signed
        // builds must also set SleepyLiveActivityAPNSEnvironment to sandbox.
        let environment = Bundle.main.object(forInfoDictionaryKey: "SleepyLiveActivityAPNSEnvironment") as? String ?? "production"
        let row: [String: Any] = ["ownerId": owner.uuidString.lowercased(), "activityId": activity.id,
            "sleepId": activity.attributes.sleepId, "babyId": activity.attributes.babyId, "token": token,
            "revision": revision, "environment": environment,
            "expiresAt": ISO8601DateFormatter().string(from: activity.attributes.presentationEndsAt)]
        log.notice("Activity token ready activityId=\(activity.id, privacy: .public) sleepId=\(activity.attributes.sleepId, privacy: .public) tokenPresent=true tokenBytes=\(bytes.count) revision=\(revision)")
        tokens[activity.id] = row
        tokenChanged?(row)
    }
    private func removeToken(_ activityId: String) {
        if let observer = tokenTasks.removeValue(forKey: activityId) {
            observer.cancel()
            if let activity = retained[activityId] {
                log.notice("Activity token observer stopped activityId=\(activityId, privacy: .public) sleepId=\(activity.attributes.sleepId, privacy: .public)")
            }
        }
        stateTasks.removeValue(forKey: activityId)?.cancel()
        if var row = tokens.removeValue(forKey: activityId) {
            row.removeValue(forKey: "token")
            row["revoked"] = true
            tokenChanged?(row)
        }
    }
    func tokenSnapshot() -> [[String: Any]] {
        Array(tokens.values)
    }
    func endActivity(ownerId: String, activityId: String) async {
        guard ownerID == UUID(uuidString: ownerId),
              let activity = managed.first(where: { $0.id == activityId }) else { return }
        await finish(activity)
    }
    private func finish(_ activity: Activity<SleepActivityAttributes>) async {
        removeToken(activity.id)
        await activity.end(ActivityContent(state: .init(soundMonitoringActive: false), staleDate: Date()), dismissalPolicy: .immediate)
        retained.removeValue(forKey: activity.id)
    }
}

@objc(SleepyLiveActivityPlugin)
public class SleepyLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SleepyLiveActivityPlugin"
    public let jsName = "SleepyLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endSleep", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logActivityTokenDiagnostic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getActivityTokens", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endActivity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endAll", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setContext", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reconcileBaby", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAuthSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearAuthSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updatePresentation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAppInfo", returnType: CAPPluginReturnPromise)
    ]
    private var pending: Task<Void, Never>?
    public override func load() {
        NotificationCenter.default.addObserver(self, selector: #selector(foregrounded), name: UIApplication.didBecomeActiveNotification, object: nil)
        Task { @MainActor [weak self] in
            if #available(iOS 16.2, *) {
                SleepLiveActivityCoordinator.shared.tokenChanged = { [weak self] row in
                    self?.notifyListeners("activityTokenChanged", data: row)
                }
            }
            SleepWakeCredentials.requestRefresh = { [weak self] owner, force in
                self?.notifyListeners("wakeSessionRefreshRequested", data: ["ownerId": owner.uuidString.lowercased(), "forceRefresh": force])
            }
            if UIApplication.shared.applicationState == .active { self?.foregrounded() }
        }
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    @objc private func foregrounded() {
        Task { @MainActor [weak self] in
            if #available(iOS 16.2, *) {
                await SleepLiveActivityCoordinator.shared.enqueue { await SleepLiveActivityCoordinator.shared.recoverForeground() }
            }
            self?.notifyListeners("foreground", data: [:], retainUntilConsumed: true)
        }
    }
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
    @objc public func updatePresentation(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *), let owner = call.getString("ownerId"),
               let options = call.options as? [String: Any],
               let sleep = SleepLiveActivityCoordinator.Sleep(options) {
                await SleepLiveActivityCoordinator.shared.updatePresentation(ownerId: owner, sleep: sleep)
            }
        }
    }
    @objc public func endSleep(_ call: CAPPluginCall) {
        perform(call) { if #available(iOS 16.2, *), let id = call.getString("sleepId") { await SleepLiveActivityCoordinator.shared.end(sleepId: id) } }
    }
    @objc public func logActivityTokenDiagnostic(_ call: CAPPluginCall) {
        let phases: Set<String> = ["listener_ready", "snapshot_read", "snapshot_failed", "native_event",
            "snapshot_token", "context_rejected", "rpc_attempt", "rpc_registered", "rpc_unchanged",
            "rpc_already_ended", "rpc_authorization_failed", "rpc_failed", "retry_on_snapshot"]
        if let phase = call.getString("phase"), phases.contains(phase) {
            let activityId = call.getString("activityId") ?? ""
            let sleepId = call.getString("sleepId").flatMap(UUID.init(uuidString:))?.uuidString ?? ""
            let revision = call.getInt("revision") ?? 0
            let present = call.getBool("tokenPresent") ?? false
            let logger = Logger(subsystem: "no.strandeconsulting.sleepy", category: "LiveActivity")
            logger.notice("Activity registration phase=\(phase, privacy: .public) activityId=\(activityId, privacy: .public) sleepId=\(sleepId, privacy: .public) tokenPresent=\(present) revision=\(revision)")
        }
        call.resolve()
    }
    @objc public func getActivityTokens(_ call: CAPPluginCall) {
        Task { @MainActor in
            if #available(iOS 16.2, *) {
                call.resolve(["tokens": SleepLiveActivityCoordinator.shared.tokenSnapshot()])
            } else { call.resolve(["tokens": []]) }
        }
    }
    @objc public func endActivity(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *), let owner = call.getString("ownerId"), let id = call.getString("activityId") {
                await SleepLiveActivityCoordinator.shared.endActivity(ownerId: owner, activityId: id)
            }
        }
    }
    @objc public func endAll(_ call: CAPPluginCall) {
        perform(call) { if #available(iOS 16.2, *) { await SleepLiveActivityCoordinator.shared.endAll() } }
    }
    @objc public func setContext(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *), let owner = call.getString("ownerId"), UUID(uuidString: owner) != nil,
               let ids = call.getArray("babyIds", String.self), ids.allSatisfy({ UUID(uuidString: $0) != nil }) {
                await SleepLiveActivityCoordinator.shared.setContext(ownerId: owner, babyIds: Set(ids))
            }
        }
    }
    @objc public func reconcileBaby(_ call: CAPPluginCall) {
        perform(call) {
            if #available(iOS 16.2, *), let owner = call.getString("ownerId"), UUID(uuidString: owner) != nil,
               let baby = call.getString("babyId"), UUID(uuidString: baby) != nil {
                let active = call.getString("activeSleepId")
                guard active == nil || UUID(uuidString: active!) != nil else { return }
                await SleepLiveActivityCoordinator.shared.reconcileBaby(ownerId: owner, babyId: baby, activeSleepId: active)
            }
        }
    }
    @objc public func setEnabled(_ call: CAPPluginCall) {
        guard let enabled = call.getBool("enabled") else { call.reject("Missing enabled preference"); return }
        perform(call) { if #available(iOS 16.2, *) { await SleepLiveActivityCoordinator.shared.setEnabled(enabled) } }
    }
    @objc public func getAppInfo(_ call: CAPPluginCall) {
        call.resolve(["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
                      "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""])
    }
    @objc public func setAuthSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard #available(iOS 17.0, *) else { call.resolve(); return }
            do {
                guard let id = call.getString("userId"), let user = UUID(uuidString: id),
                      let token = call.getString("accessToken"), let expiry = call.getDouble("expiresAt"),
                      let value = call.getString("url"), let url = URL(string: value),
                      let key = call.getString("anonKey") else {
                    try SleepWakeCredentials.clear()
                    throw SleepWakeFailure.authentication
                }
                try SleepWakeCredentials.replace(.init(userId: user, accessToken: token, expiresAt: expiry, url: url, anonKey: key))
                call.resolve()
            } catch { call.reject("Wake up authentication unavailable") }
        }
    }
    @objc public func clearAuthSession(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard #available(iOS 17.0, *) else { call.resolve(); return }
            do { try SleepWakeCredentials.clear(); call.resolve() }
            catch { call.reject("Could not clear Wake up authentication") }
        }
    }
}
