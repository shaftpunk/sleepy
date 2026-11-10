import AVFoundation
import Capacitor
import UIKit
import os

// App-local level input only. No recorder, file writer or audio data bridge.
@objc(SleepySoundMeterPlugin)
public class SleepySoundMeterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SleepySoundMeterPlugin"
    public let jsName = "SleepySoundMeter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let log = Logger(subsystem: "no.strandeconsulting.sleepy", category: "SoundMeter")
    private var engine: AVAudioEngine?
    private var sessionActive = false
    private var runId: String?
    private var stage = "idle"
    private var firstLevelEmitted = false
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        for (name, reason) in [(UIScene.didEnterBackgroundNotification, "scene-background"),
                               (UIApplication.didEnterBackgroundNotification, "app-background"),
                               (AVAudioSession.mediaServicesWereResetNotification, "audio-services-reset")] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.finish(reason: reason)
            })
        }
        // Inactivity (including permission sheets) is not backgrounding.
        for name in [UIScene.willDeactivateNotification, UIApplication.willResignActiveNotification,
                     UIScene.didActivateNotification, UIApplication.didBecomeActiveNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                guard let self = self, self.runId != nil else { return }
                self.log.info("[SoundMeter] lifecycle observation appState=\(UIApplication.shared.applicationState.rawValue, privacy: .public) stage=\(self.stage, privacy: .public); no inactivity stop")
            })
        }
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            if let value = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               value == AVAudioSession.InterruptionType.began.rawValue {
                self?.finish(reason: "interrupted")
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] note in
            guard let self = self, self.runId != nil else { return }
            let reason = (note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue ?? 0
            self.log.info("[SoundMeter] route change reason=\(reason, privacy: .public) stage=\(self.stage, privacy: .public) engineRunning=\(self.engine?.isRunning == true, privacy: .public)")
            guard let engine = self.engine else { return }
            let session = AVAudioSession.sharedInstance()
            let format = engine.inputNode.outputFormat(forBus: 0)
            let engineStarting = self.stage == "prepare" || self.stage == "engine.start"
            // setCategory itself can enqueue categoryChange. Its main-queue
            // callback may run only after startEngine has installed the engine.
            // That notification is not evidence that healthy capture ended.
            if reason == AVAudioSession.RouteChangeReason.categoryChange.rawValue,
               self.sessionActive, session.category == .record, session.mode == .default,
               (engine.isRunning || engineStarting), format.sampleRate > 0, format.channelCount > 0 {
                self.log.info("[SoundMeter] benign category change ignored; configured input starting or running")
                return
            }
            self.finish(reason: "input-route-changed")
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
            if let self = self, let changed = note.object as? AVAudioEngine, changed === self.engine {
                self.log.info("[SoundMeter] engine configuration notification isRunning=\(changed.isRunning, privacy: .public) stage=\(self.stage, privacy: .public)")
                let engineStarting = self.stage == "prepare" || self.stage == "engine.start"
                if !changed.isRunning && !engineStarting { self.finish(reason: "engine-configuration-changed") }
            }
        })
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.reject("Input adapter unavailable", "UNAVAILABLE"); return }
            self.log.info("[SoundMeter] start requested appState=\(UIApplication.shared.applicationState.rawValue, privacy: .public)")
            guard let id = call.getString("runId"), UUID(uuidString: id) != nil else {
                self.rejectStart(call, stage: "request", code: "UNAVAILABLE", message: "Invalid monitoring request"); return
            }
            guard self.runId == nil else { self.rejectStart(call, stage: "request", code: "START_FAILED", message: "Microphone already in use"); return }
            guard UIApplication.shared.applicationState != .background else { self.rejectStart(call, stage: "foreground-check", code: "CANCELLED", message: "App must be in foreground"); return }
            self.runId = id
            self.stage = "permission"
            self.firstLevelEmitted = false
            let session = AVAudioSession.sharedInstance()
            let permission = session.recordPermission
            let permissionName = permission == .granted ? "granted" : permission == .denied ? "denied" : permission == .undetermined ? "not-requested" : "unknown"
            self.log.info("[SoundMeter] permission status=\(permissionName, privacy: .public)")
            switch permission {
            case .granted: self.startEngine(call, id: id)
            case .denied:
                self.runId = nil; self.rejectStart(call, stage: "permission", code: "PERMISSION_DENIED", message: "Microphone permission denied")
            case .undetermined:
                session.requestRecordPermission { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self = self else { call.reject("Input adapter unavailable", "UNAVAILABLE"); return }
                        self.log.info("[SoundMeter] permission result granted=\(granted, privacy: .public)")
                        guard self.runId == id else { self.rejectStart(call, stage: "permission-result", code: "CANCELLED", message: "Monitoring cancelled"); return }
                        if granted { self.startEngine(call, id: id) }
                        else { self.runId = nil; self.rejectStart(call, stage: "permission-result", code: "PERMISSION_DENIED", message: "Microphone permission denied") }
                    }
                }
            @unknown default:
                self.runId = nil; self.rejectStart(call, stage: "permission", code: "UNAVAILABLE", message: "Microphone unavailable")
            }
        }
    }

    private func startEngine(_ call: CAPPluginCall, id: String) {
        guard runId == id, UIApplication.shared.applicationState != .background else {
            finish(reason: "cancelled"); rejectStart(call, stage: "foreground-or-run-check", code: "CANCELLED", message: "Monitoring cancelled"); return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            stage = "setCategory"
            try session.setCategory(.record, mode: .default, options: [])
            log.info("[SoundMeter] session category configured category=record mode=default options=none")
            stage = "setActive"
            try session.setActive(true)
            sessionActive = true
            log.info("[SoundMeter] session activated inputAvailable=\(session.isInputAvailable, privacy: .public)")
            stage = "inputNode"
            let audioEngine = AVAudioEngine()
            let input = audioEngine.inputNode
            stage = "inputFormat"
            let format = input.outputFormat(forBus: 0)
            log.info("[SoundMeter] input format sampleRate=\(format.sampleRate, privacy: .public) channelCount=\(format.channelCount, privacy: .public) format=\(format.commonFormat.rawValue, privacy: .public) interleaved=\(format.isInterleaved, privacy: .public)")
            guard format.sampleRate > 0, format.channelCount > 0,
                  format.commonFormat == .pcmFormatFloat32, !format.isInterleaved else {
                finish(reason: "invalid-input-format", notify: false)
                rejectStart(call, stage: "inputFormat", code: "UNAVAILABLE", message: "Invalid microphone input format"); return
            }
            // TEMPORARY safe diagnostics. No samples/buffers/peripheral names.
            var buffers = 0
            var pendingEnergy = 0.0
            var pendingFrames = 0
            var pendingPeak = 0.0
            var lastEmission = 0.0
            var lastLog = 0.0
            stage = "installTap"
            log.info("[SoundMeter] installing tap")
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                guard let self = self else { return }
                buffers += 1
                let channels = Int(buffer.format.channelCount)
                let frames = Int(buffer.frameLength)
                if buffers == 1 {
                    let hasFloatSamples = buffer.floatChannelData != nil
                    DispatchQueue.main.async { [weak self] in
                        self?.log.info("[SoundMeter] first buffer received frames=\(frames, privacy: .public) channels=\(channels, privacy: .public) floatSamplesAvailable=\(hasFloatSamples, privacy: .public)")
                    }
                }
                guard let samples = buffer.floatChannelData, frames > 0, channels > 0 else { return }
                var energy = 0.0
                var peak = 0.0
                for channel in 0..<channels {
                    for frame in 0..<frames {
                        let sample = Double(samples[channel][frame])
                        if sample.isFinite { energy += sample * sample; peak = max(peak, abs(sample)) }
                    }
                }
                // Include every tap buffer, not just the buffer at the bridge
                // emission instant, so short sounds between emissions survive.
                pendingEnergy += energy
                pendingFrames += frames
                pendingPeak = max(pendingPeak, peak)
                let time = ProcessInfo.processInfo.systemUptime
                guard time - lastEmission >= 0.1 else { return }
                lastEmission = time
                let rms = min(1.0, sqrt(pendingEnergy / Double(pendingFrames * channels)))
                let dbFS = 20.0 * log10(max(rms, 0.000001))
                let emittedFrames = pendingFrames
                let peakValue = min(1.0, pendingPeak)
                pendingEnergy = 0
                pendingFrames = 0
                pendingPeak = 0
                let count = buffers
                let sampleRate = buffer.format.sampleRate
                // Only scalar metadata is captured by this closure, never buffer.
                let shouldLog = time - lastLog >= 1
                if shouldLog { lastLog = time }
                DispatchQueue.main.async { [weak self] in
                    guard let self = self else { return }
                    guard self.runId == id, self.engine?.isRunning == true else {
                        if shouldLog { self.log.info("[SoundMeter] level dropped currentRun=\(self.runId == id, privacy: .public) engineRunning=\(self.engine?.isRunning == true, privacy: .public)") }
                        return
                    }
                    if !self.firstLevelEmitted {
                        self.firstLevelEmitted = true
                        self.log.info("[SoundMeter] first level emitted")
                    }
                    self.stage = "receiving-levels"
                    if shouldLog {
                        self.log.info("[SoundMeter] Input buffers=\(count, privacy: .public) frames=\(emittedFrames, privacy: .public) rms=\(rms, privacy: .public) peak=\(peakValue, privacy: .public) dbFS=\(dbFS, privacy: .public); emitting level")
                    }
                    self.notifyListeners("level", data: ["runId": id, "rms": rms, "peak": peakValue, "dbFS": dbFS,
                        "bufferCount": count, "frameCount": emittedFrames, "sampleRate": sampleRate, "channels": channels])
                }
            }
            log.info("[SoundMeter] tap installed")
            engine = audioEngine
            stage = "prepare"
            log.info("[SoundMeter] preparing engine")
            audioEngine.prepare()
            log.info("[SoundMeter] engine prepared")
            stage = "engine.start"
            log.info("[SoundMeter] starting engine")
            try audioEngine.start()
            stage = "waiting-first-buffer"
            log.info("[SoundMeter] engine started isRunning=\(audioEngine.isRunning, privacy: .public)")
            call.resolve()
        } catch {
            // Avoid localized error descriptions that can include route/device names.
            let failedStage = stage
            finish(reason: "start-failed", notify: false)
            rejectStart(call, stage: failedStage, code: "START_FAILED", message: "Could not start microphone", error: error)
        }
    }

    private func rejectStart(_ call: CAPPluginCall, stage: String, code: String, message: String, error: Error? = nil) {
        // No localized error/userInfo: those can contain route/device names.
        let osCode = error.map { ($0 as NSError).code } ?? 0
        log.error("[SoundMeter] START FAILED stage=\(stage, privacy: .public) error=\(code, privacy: .public) osCode=\(osCode, privacy: .public)")
        call.reject(message, code)
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            if let id = call.getString("runId"), self?.runId == id {
                let requested = call.getString("reason") ?? "stop"
                let allowed = ["stop", "manual-stop", "restart", "component-or-session-cleanup", "logout", "session-changed",
                    "startup-timeout", "level-events-stalled", "capacitor-pause-background", "pagehide", "start-failed",
                    "native-start-rejected", "cancelled-start-completed", "invalid-native-level-metadata",
                    "native:scene-background", "native:app-background", "native:audio-services-reset", "native:interrupted",
                    "native:input-route-changed", "native:engine-configuration-changed", "native:cancelled", "native:stopped",
                    "native:unknown-native-stop", "native:start-failed", "native:invalid-input-format"]
                self?.finish(reason: allowed.contains(requested) ? "js:\(requested)" : "js:stop")
            }
            call.resolve()
        }
    }
    private func finish(reason: String, notify: Bool = true) {
        guard let id = runId else { return }
        log.info("[SoundMeter] stop requested reason=\(reason, privacy: .public) stage=\(self.stage, privacy: .public) appState=\(UIApplication.shared.applicationState.rawValue, privacy: .public) engineRunning=\(self.engine?.isRunning == true, privacy: .public)")
        runId = nil
        if let engine = engine { engine.inputNode.removeTap(onBus: 0); engine.stop() }
        engine = nil
        if sessionActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        sessionActive = false
        stage = "idle"
        log.info("[SoundMeter] microphone released")
        if notify { notifyListeners("stopped", data: ["runId": id, "reason": reason]) }
    }
    deinit {
        log.info("[SoundMeter] plugin deinitialized")
        observers.forEach { NotificationCenter.default.removeObserver($0) }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        if sessionActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
    }
}

// CAPBridgeViewController retains the app-local plugin instance for its lifetime.
class SleepyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(SleepySoundMeterPlugin())
    }
}
