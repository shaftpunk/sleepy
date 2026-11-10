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
    private var observers: [NSObjectProtocol] = []

    public override func load() {
        let center = NotificationCenter.default
        for name in [UIScene.didEnterBackgroundNotification, UIApplication.didEnterBackgroundNotification,
                     AVAudioSession.mediaServicesWereResetNotification] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.finish(reason: "background-or-audio-reset")
            })
        }
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            if let value = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
               value == AVAudioSession.InterruptionType.began.rawValue {
                self?.finish(reason: "interrupted")
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            if self?.engine != nil { self?.finish(reason: "input-route-changed") }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: nil, queue: .main) { [weak self] note in
            if let changed = note.object as? AVAudioEngine, changed === self?.engine, !changed.isRunning {
                self?.finish(reason: "engine-configuration-changed")
            }
        })
    }

    @objc public func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let id = call.getString("runId"), UUID(uuidString: id) != nil else {
                call.reject("Invalid monitoring request", "UNAVAILABLE"); return
            }
            guard self.runId == nil else { call.reject("Microphone already in use", "START_FAILED"); return }
            guard UIApplication.shared.applicationState != .background else { call.reject("App must be in foreground", "CANCELLED"); return }
            self.runId = id
            let session = AVAudioSession.sharedInstance()
            switch session.recordPermission {
            case .granted: self.startEngine(call, id: id)
            case .denied:
                self.runId = nil; call.reject("Microphone permission denied", "PERMISSION_DENIED")
            case .undetermined:
                session.requestRecordPermission { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self = self, self.runId == id else { call.reject("Monitoring cancelled", "CANCELLED"); return }
                        if granted { self.startEngine(call, id: id) }
                        else { self.runId = nil; call.reject("Microphone permission denied", "PERMISSION_DENIED") }
                    }
                }
            @unknown default:
                self.runId = nil; call.reject("Microphone unavailable", "UNAVAILABLE")
            }
        }
    }

    private func startEngine(_ call: CAPPluginCall, id: String) {
        guard runId == id, UIApplication.shared.applicationState != .background else {
            finish(reason: "cancelled"); call.reject("Monitoring cancelled", "CANCELLED"); return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default, options: [])
            try session.setActive(true)
            sessionActive = true
            log.info("Session activated category=record mode=default inputAvailable=\(session.isInputAvailable, privacy: .public)")
            let audioEngine = AVAudioEngine()
            let input = audioEngine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0,
                  format.commonFormat == .pcmFormatFloat32, !format.isInterleaved else {
                try? session.setActive(false, options: .notifyOthersOnDeactivation)
                sessionActive = false
                runId = nil; call.reject("Invalid microphone input format", "UNAVAILABLE"); return
            }
            // TEMPORARY safe diagnostics. No samples/buffers/peripheral names.
            log.info("Session active; input tap installing. sampleRate=\(format.sampleRate, privacy: .public) channels=\(format.channelCount, privacy: .public) float32=true interleaved=false")
            var buffers = 0
            var pendingEnergy = 0.0
            var pendingFrames = 0
            var pendingPeak = 0.0
            var lastEmission = 0.0
            var lastLog = 0.0
            input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                guard let self = self, let samples = buffer.floatChannelData, buffer.frameLength > 0 else { return }
                buffers += 1
                var energy = 0.0
                var peak = 0.0
                let channels = Int(buffer.format.channelCount)
                let frames = Int(buffer.frameLength)
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
                    guard let self = self, self.runId == id, self.engine?.isRunning == true else { return }
                    if shouldLog {
                        self.log.info("Input buffers=\(count, privacy: .public) frames=\(emittedFrames, privacy: .public) rms=\(rms, privacy: .public) peak=\(peakValue, privacy: .public) dbFS=\(dbFS, privacy: .public); emitting level")
                    }
                    self.notifyListeners("level", data: ["runId": id, "rms": rms, "peak": peakValue, "dbFS": dbFS,
                        "bufferCount": count, "frameCount": emittedFrames, "sampleRate": sampleRate, "channels": channels])
                }
            }
            engine = audioEngine
            audioEngine.prepare()
            try audioEngine.start()
            log.info("Engine started; isRunning=\(audioEngine.isRunning, privacy: .public). Waiting for microphone buffers.")
            call.resolve()
        } catch {
            // Avoid localized error descriptions that can include route/device names.
            log.error("Audio setup failed; OS code=\((error as NSError).code, privacy: .public)")
            finish(reason: "start-failed", notify: false)
            call.reject("Could not start microphone", "START_FAILED")
        }
    }

    @objc public func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async { [weak self] in
            if let id = call.getString("runId"), self?.runId == id { self?.finish(reason: "stopped") }
            call.resolve()
        }
    }
    private func finish(reason: String, notify: Bool = true) {
        guard let id = runId else { return }
        runId = nil
        if let engine = engine { engine.inputNode.removeTap(onBus: 0); engine.stop() }
        engine = nil
        if sessionActive { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) }
        sessionActive = false
        log.info("Microphone released")
        if notify { notifyListeners("stopped", data: ["runId": id, "reason": reason]) }
    }
    deinit {
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
