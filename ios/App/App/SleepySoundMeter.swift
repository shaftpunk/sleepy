import AVFoundation
import Capacitor
import UIKit
import os

// Audio stays inside the tap. Only scalar metering and finalized metadata leave it.
@objc(SleepySoundMeterPlugin)
public class SleepySoundMeterPlugin: CAPPlugin, CAPBridgedPlugin {
    // The registered bridge owns capture; the intent may only stop that
    // instance's exact confirmed sleep. Cold intent launches have no capture.
    private static weak var captureOwner: SleepySoundMeterPlugin?
    public let identifier = "SleepySoundMeterPlugin"
    public let jsName = "SleepySoundMeter"
    public let pluginMethods: [CAPPluginMethod] = ["start", "stop", "getState", "getEvents", "acknowledge"].map {
        CAPPluginMethod(name: $0, returnType: CAPPluginReturnPromise)
    }
    private let log = Logger(subsystem: "no.strandeconsulting.sleepy", category: "SoundMeter")
    private var engine: AVAudioEngine?
    private var session: SoundSession?
    private var detector: NativeSoundDetector?
    private var eventQueue: NativeSoundEventQueue?
    private var observers: [NSObjectProtocol] = []
    private var visualTimer: DispatchSourceTimer?
    private var healthTimer: DispatchSourceTimer?
    private var foreground = true
    private var stage = "off"
    private var lastSample: Double?
    private var captureStartedAt: Double?
    private var lastRecoveryMs = 0.0
    private var latestRms = 0.0
    private var visualPeak = 0.0
    private var latestPeak = 0.0
    private var buffers = 0
    private var frames = 0
    private var sampleRate = 0.0
    private var channels = 0
    private let intent = MonitoringIntent()
    private var stopReason = ""
    private var sessionActive = false
    // Read-only, single-sleep validity capability. Never encoded into queue files.
    private var lease: (url: URL, token: String, expiresAt: Double)?
    private var validityTask: URLSessionDataTask?
    private var validityStarted = 0.0
    private var lastValidityCheck = 0.0
    private var lastValiditySuccess = 0.0
    private var pendingStartCall: CAPPluginCall?
    private lazy var validitySession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = RemoteValidityPolicy.networkTimeoutSeconds
        config.timeoutIntervalForResource = RemoteValidityPolicy.networkTimeoutSeconds
        config.urlCache = nil; config.httpCookieStorage = nil; config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }()
    private func now() -> Double { floor(Date().timeIntervalSince1970 * 1000) }

    public override func load() {
        Self.captureOwner = self
        // A newly created native input plugin owns no running capture. Do not
        // retain an old bridge instance's last-reported microphone flag.
        if #available(iOS 16.2, *) {
            Task { @MainActor in
                await SleepLiveActivityCoordinator.shared.enqueue { await SleepLiveActivityCoordinator.shared.resetSoundStatus() }
            }
        }
        foreground = UIApplication.shared.applicationState != .background
        do {
            let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("SleepySound", isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var excluded = root
            var flags = URLResourceValues(); flags.isExcludedFromBackup = true; try excluded.setResourceValues(flags)
            eventQueue = try NativeSoundEventQueue(url: root.appendingPathComponent("events.json"))
        } catch { log.error("[SoundMeter] Metadata queue unavailable; monitoring will not start") }
        let center = NotificationCenter.default
        for name in [UIScene.didEnterBackgroundNotification, UIApplication.didEnterBackgroundNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.intent.background(); self?.foreground = false; self?.stopVisuals() // Capture/detector continue natively.
            })
        }
        for name in [UIScene.didActivateNotification, UIApplication.didBecomeActiveNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self = self else { return }; self.intent.activate(); self.foreground = true
                if self.session != nil && AVAudioSession.sharedInstance().recordPermission != .granted { self.finish(reason: "permission-revoked") }
                self.visualPeak = self.latestRms; self.startVisuals(); self.publishState()
            })
        }
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, let type = (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue else { return }
            if type == AVAudioSession.InterruptionType.began.rawValue { self.intent.interruptionBegan(); self.pauseInput(reason: "interrupted") }
            else if type == AVAudioSession.InterruptionType.ended.rawValue {
                let options = (note.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
                if self.intent.interruptionEnded(shouldResume: AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)), let id = self.session?.runId {
                    self.startEngine(call: nil, id: id)
                } else { self.finish(reason: "interruption-ended-without-resume") }
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, self.session != nil, self.engine != nil else { return }
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
            if reason == AVAudioSession.RouteChangeReason.categoryChange.rawValue && AVAudioSession.sharedInstance().category == .record { return }
            self.recoverInput(reason: "route-change")
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
            if let self = self, let changed = note.object as? AVAudioEngine, changed === self.engine, !changed.isRunning, self.stage != "starting" {
                self.recoverInput(reason: "engine-configuration")
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in self?.recoverInput(reason: "audio-reset") })
    }
    @MainActor
    static func stopConfirmedSleep(sleepId: UUID, ownerId: UUID) {
        guard let plugin = captureOwner, let context = plugin.session,
              UUID(uuidString: context.sleepId) == sleepId, UUID(uuidString: context.userId) == ownerId else { return }
        plugin.finish(reason: "sleep-ended-or-unavailable")
    }
    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("Input unavailable", "UNAVAILABLE"); return }
            guard let id = call.getString("runId"), UUID(uuidString: id) != nil,
                  let user = call.getString("userId"), UUID(uuidString: user) != nil,
                  let baby = call.getString("babyId"), UUID(uuidString: baby) != nil,
                  let sleep = call.getString("sleepId"), UUID(uuidString: sleep) != nil,
                  let threshold = call.getDouble("threshold"), [0.12, 0.06, 0.025].contains(threshold),
                  let lease = call.getObject("lease"), let endpoint = lease["url"] as? String, let url = URL(string: endpoint),
                  url.scheme == "https", url.path == "/functions/v1/sound-monitor-status", url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
                  let token = lease["token"] as? String, !token.isEmpty, token.count <= 2048,
                  let expiresAt = lease["expiresAt"] as? Double, expiresAt > self.now() else { call.reject("Invalid monitoring session", "UNAVAILABLE"); return }
            guard self.session == nil else { call.reject("Monitoring already active", "START_FAILED"); return }
            guard UIApplication.shared.applicationState != .background else { call.reject("Start in foreground", "CANCELLED"); return }
            guard let queue = self.eventQueue, queue.events.count < NativeSoundEventQueue.capacity - 1 else { call.reject("Sound event storage unavailable or full", "QUEUE_FULL"); return }
            let context = SoundSession(runId: id, userId: user, babyId: baby, sleepId: sleep, threshold: threshold)
            self.session = context; self.stage = "starting"; self.lastSample = nil; self.stopReason = ""
            self.lease = (url, token, expiresAt); self.lastValidityCheck = 0; self.lastValiditySuccess = self.now()
            self.intent.begin()
            self.buffers = 0; self.visualPeak = 0; self.latestRms = 0
            self.lastRecoveryMs = 0
            self.detector = NativeSoundDetector(threshold: threshold) { [weak self] observation in self?.enqueue(observation, context: context) }
            self.startHealthChecks()
            let audio = AVAudioSession.sharedInstance()
            if audio.recordPermission == .granted { self.startEngine(call: call, id: id) }
            else if audio.recordPermission == .undetermined {
                audio.requestRecordPermission { [weak self] granted in DispatchQueue.main.async {
                    guard let self = self, self.session?.runId == id else { call.reject("Monitoring cancelled", "CANCELLED"); return }
                    if granted { self.startEngine(call: call, id: id) }
                    else { self.finish(reason: "permission-denied"); call.reject("Microphone permission denied", "PERMISSION_DENIED") }
                } }
            } else { self.finish(reason: "permission-denied"); call.reject("Microphone permission denied", "PERMISSION_DENIED") }
        }
    }
    private func startEngine(call: CAPPluginCall?, id: String) {
        guard session?.runId == id else { call?.reject("Monitoring cancelled", "CANCELLED"); return }
        guard intent.mayRecover else { stage = "paused"; publishState(); call?.resolve(); return }
        guard AVAudioSession.sharedInstance().recordPermission == .granted else { finish(reason: "permission-revoked"); call?.reject("Microphone permission denied", "PERMISSION_DENIED"); return }
        // A long permission sheet/interruption may outlive our latest validity
        // check. Reconfirm before resuming microphone input, not afterward.
        if now() - lastValiditySuccess >= RemoteValidityPolicy.pollMs {
            pendingStartCall = call; stage = "waiting-validity"
            if validityTask == nil { checkRemoteValidity() }
            return
        }
        do {
            stage = "starting"
            buffers = 0; visualPeak = 0; latestRms = 0; frames = 0
            let audio = AVAudioSession.sharedInstance()
            try audio.setCategory(.record, mode: .default, options: [])
            try audio.setActive(true); sessionActive = true
            let inputEngine = AVAudioEngine()
            let input = inputEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0, format.commonFormat == .pcmFormatFloat32, !format.isInterleaved else {
                finish(reason: "invalid-input-format"); call?.reject("Invalid input format", "UNAVAILABLE"); return
            }
            var energy = 0.0, count = 0, lastDetection = 0.0
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let data = buffer.floatChannelData, buffer.frameLength > 0, buffer.format.channelCount > 0 else { return }
                let channelCount = Int(buffer.format.channelCount), frameCount = Int(buffer.frameLength)
                var bufferEnergy = 0.0, bufferPeak = 0.0
                for channel in 0..<channelCount { for frame in 0..<frameCount {
                    let value = Double(data[channel][frame]); if value.isFinite { bufferEnergy += value * value; bufferPeak = max(bufferPeak, abs(value)) }
                } }
                energy += bufferEnergy; count += frameCount * channelCount
                let instantRms = min(1, sqrt(bufferEnergy / Double(frameCount * channelCount)))
                let instantPeak = min(1, bufferPeak), rate = buffer.format.sampleRate
                let time = ProcessInfo.processInfo.systemUptime
                var detectionRms: Double?
                if time - lastDetection >= 0.1 { detectionRms = min(1, sqrt(energy / Double(count))); energy = 0; count = 0; lastDetection = time }
                let timestamp = floor(Date().timeIntervalSince1970 * 1000)
                // Capture scalars only; never send/retain buffer or sample pointers.
                DispatchQueue.main.async { [weak self] in
                    guard let self = self, self.session?.runId == id, self.engine === inputEngine else { return }
                    self.buffers += 1; self.frames = frameCount; self.sampleRate = rate; self.channels = channelCount
                    self.latestRms = instantRms; self.visualPeak = self.foreground ? max(self.visualPeak, instantRms) : instantRms; self.latestPeak = instantPeak
                    if let rms = detectionRms {
                        self.lastSample = timestamp; self.detector?.sample(rms, at: timestamp)
                        self.stage = self.detector?.detected == true ? "detected" : "listening"
                    }
                }
            }
            engine = inputEngine; inputEngine.prepare(); try inputEngine.start()
            captureStartedAt = now()
            startVisuals(); publishState(); call?.resolve()
            log.info("[SoundMeter] background-capable capture started; engineRunning=\(inputEngine.isRunning, privacy: .public)")
        } catch {
            log.error("[SoundMeter] capture failed OS code=\((error as NSError).code, privacy: .public)")
            finish(reason: "start-failed"); call?.reject("Could not start microphone", "START_FAILED")
        }
    }
    private func startVisuals() {
        guard foreground, session != nil, engine?.isRunning == true, visualTimer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(60), leeway: .milliseconds(5))
        timer.setEventHandler { [weak self] in
            guard let self = self, let context = self.session, self.foreground, self.buffers > 0 else { return }
            let level = self.visualPeak; self.visualPeak = self.latestRms
            self.notifyListeners("level", data: ["runId": context.runId, "rms": self.latestRms, "displayRms": level,
                "peak": self.latestPeak, "dbFS": 20 * log10(max(self.latestRms, 0.000001)),
                "bufferCount": self.buffers, "frameCount": self.frames, "sampleRate": self.sampleRate,
                "channels": self.channels, "detected": self.detector?.detected == true])
        }
        visualTimer = timer; timer.resume()
    }
    private func stopVisuals() { visualTimer?.cancel(); visualTimer = nil }
    private func startHealthChecks() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 2, repeating: .seconds(2))
        timer.setEventHandler { [weak self] in
            guard let self = self, self.session != nil else { return }
            if let lease = self.lease, self.now() >= lease.expiresAt { self.finish(reason: "remote-lease-expired"); return }
            if RemoteValidityPolicy.timedOut(now: self.now(), started: self.validityStarted, pending: self.validityTask != nil) { self.finish(reason: "remote-validity-unavailable"); return }
            if RemoteValidityPolicy.shouldPoll(now: self.now(), lastAttempt: self.lastValidityCheck, pending: self.validityTask != nil) { self.checkRemoteValidity() }
            if AVAudioSession.sharedInstance().recordPermission == .denied { self.finish(reason: "permission-revoked"); return }
            if self.stage == "starting", let started = self.captureStartedAt, self.now() - started > 3000 {
                self.finish(reason: "audio-stalled"); return
            }
            if self.engine != nil, self.engine?.isRunning == false, self.stage != "starting", self.stage != "paused" {
                self.recoverInput(reason: "engine-not-running"); return
            }
            if self.engine?.isRunning == true, self.stage != "paused", self.stage != "starting", let last = self.lastSample, self.now() - last > 2000 {
                self.finish(reason: "audio-stalled")
            }
        }
        healthTimer = timer; timer.resume()
    }
    private func checkRemoteValidity() {
        guard let context = session, let lease = lease else { finish(reason: "remote-validity-unavailable"); return }
        validityStarted = now(); lastValidityCheck = validityStarted
        var request = URLRequest(url: lease.url)
        request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["action": "validate", "lease": lease.token,
            "userId": context.userId, "babyId": context.babyId, "sleepId": context.sleepId])
        let task = validitySession.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self, self.session?.runId == context.runId else { return }
                self.validityTask = nil
                guard error == nil, let response = response as? HTTPURLResponse, response.statusCode == 200,
                      let data = data, data.count < 1024,
                      let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                      let active = value["active"] as? Bool else { self.finish(reason: "remote-validity-unavailable"); return }
                if !active { self.finish(reason: "remote-session-ended-or-access-revoked") }
                else {
                    self.lastValiditySuccess = self.now()
                    if self.stage == "waiting-validity" {
                        let call = self.pendingStartCall; self.pendingStartCall = nil
                        self.startEngine(call: call, id: context.runId)
                    }
                }
            }
        }
        validityTask = task; task.resume()
    }
    private func enqueue(_ observation: SoundObservation, context: SoundSession) {
        do {
            guard let queue = eventQueue else { throw NativeSoundEventQueue.Failure.invalidArchive }
            try queue.append(NativeSoundEvent(session: context, observation: observation))
            if foreground { notifyListeners("eventsAvailable", data: [:]) }
            if queue.events.count >= NativeSoundEventQueue.capacity - 1 { DispatchQueue.main.async { [weak self] in self?.finish(reason: "queue-full") } }
        } catch {
            eventQueue = nil // Preserve the atomic archive; require reload before further writes/capture.
            DispatchQueue.main.async { [weak self] in self?.finish(reason: "metadata-storage-failed") }
        }
    }
    private func pauseInput(reason: String) {
        guard session != nil else { return }
        detector?.flush(at: lastSample ?? now()); releaseEngine(); stage = "paused"; publishState()
        log.info("[SoundMeter] input paused; no capture during interruption")
    }
    private func recoverInput(reason: String) {
        guard let id = session?.runId else { return }
        if now() - lastRecoveryMs < 5000 { finish(reason: "unrecoverable-input"); return }
        lastRecoveryMs = now()
        pauseInput(reason: reason)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self = self, self.session?.runId == id, self.stage == "paused", self.intent.mayRecover else { return }
            self.startEngine(call: nil, id: id)
        }
    }
    private func releaseEngine() {
        stopVisuals()
        if let active = engine { engine = nil; active.inputNode.removeTap(onBus: 0); active.stop() }
        if sessionActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        sessionActive = false
        captureStartedAt = nil
    }
    private func finish(reason: String) {
        guard let context = session else { return }
        detector?.flush(at: lastSample ?? now()); session = nil; detector = nil; intent.stop()
        healthTimer?.cancel(); healthTimer = nil
        validityTask?.cancel(); validityTask = nil; lease = nil
        pendingStartCall?.reject("Monitoring session no longer valid", "CANCELLED"); pendingStartCall = nil
        stopReason = reason
        releaseEngine(); stage = "off"
        publishLiveActivitySound(sleepId: context.sleepId, running: false)
        if foreground { notifyListeners("stopped", data: ["runId": context.runId, "reason": reason]) }
        log.info("[SoundMeter] capture stopped")
    }
    private func stateData() -> [String: Any] {
        var result: [String: Any] = ["active": session != nil, "running": engine?.isRunning == true, "status": stage == "waiting-validity" ? "validating" : stage,
                                   "queueCount": eventQueue?.events.count ?? 0, "stopReason": stopReason]
        if let context = session { result.merge(["runId": context.runId, "userId": context.userId, "babyId": context.babyId, "sleepId": context.sleepId, "threshold": context.threshold]) { _, new in new } }
        return result
    }
    private func publishState() {
        if let context = session { publishLiveActivitySound(sleepId: context.sleepId, running: engine?.isRunning == true) }
        if foreground { notifyListeners("state", data: stateData()) }
    }
    private func publishLiveActivitySound(sleepId: String, running: Bool) {
        if #available(iOS 16.2, *) {
            Task { @MainActor in
                await SleepLiveActivityCoordinator.shared.enqueue {
                    await SleepLiveActivityCoordinator.shared.soundChanged(sleepId: sleepId, running: running)
                }
            }
        }
    }
    @objc public func getState(_ call: CAPPluginCall) { DispatchQueue.main.async { [weak self] in call.resolve(self?.stateData() ?? ["active": false]) } }
    @objc public func stop(_ call: CAPPluginCall) { DispatchQueue.main.async { [weak self] in
        if let id = call.getString("runId"), self?.session?.runId == id { self?.finish(reason: "user-or-session-stop") }; call.resolve()
    } }
    @objc public func getEvents(_ call: CAPPluginCall) { DispatchQueue.main.async { [weak self] in
        guard let user = call.getString("userId"), let queue = self?.eventQueue else { call.reject("Queue unavailable"); return }
        let rows = queue.events.filter { $0.session.userId == user }.prefix(20).map { event -> [String: Any] in
            ["id": event.id, "created_by_user_id": event.session.userId, "baby_id": event.session.babyId,
             "sleep_id": event.session.sleepId, "startMs": event.observation.startMs, "endMs": event.observation.endMs,
             "avg_level": event.observation.avgLevel, "max_level": event.observation.maxLevel]
        }; call.resolve(["events": rows])
    } }
    @objc public func acknowledge(_ call: CAPPluginCall) { DispatchQueue.main.async { [weak self] in
        do {
            guard let user = call.getString("userId"), let ids = call.getArray("ids", String.self), let queue = self?.eventQueue else { call.reject("Invalid acknowledgement"); return }
            try queue.acknowledge(userId: user, ids: Set(ids)); call.resolve()
        } catch { call.reject("Could not acknowledge metadata") }
    } }
    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        visualTimer?.cancel(); healthTimer?.cancel(); engine?.inputNode.removeTap(onBus: 0); engine?.stop()
        validityTask?.cancel(); validitySession.invalidateAndCancel()
    }
}

class SleepyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(SleepySoundMeterPlugin())
        bridge?.registerPluginInstance(SleepyLiveActivityPlugin())
    }
}
