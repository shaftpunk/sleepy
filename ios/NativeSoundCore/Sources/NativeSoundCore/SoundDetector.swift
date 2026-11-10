import Foundation

public struct SoundObservation: Codable, Equatable {
    public let startMs: Double
    public let endMs: Double
    public let avgLevel: Double
    public let maxLevel: Double
}

// Exact port of src/sound/detector.ts. Time is epoch milliseconds. Keep parity
// fixtures/tests when changing either implementation; values are linear RMS.
public final class NativeSoundDetector {
    private var start: Double?
    private var quietSince: Double?
    private var last: Double?
    private var sum = 0.0
    private var count = 0
    private var peak = 0.0
    public private(set) var detected = false
    private let threshold: Double
    private let emit: (SoundObservation) -> Void

    public init(threshold: Double, emit: @escaping (SoundObservation) -> Void) {
        self.threshold = threshold; self.emit = emit
    }
    public func sample(_ input: Double, at now: Double) {
        guard input.isFinite, now.isFinite else { return }
        if let last = last, now - last > 1000 || now < last { flush(at: last) }
        last = now
        let level = max(0, min(1, input))
        if level >= threshold {
            if start == nil { start = now }
            quietSince = nil; sum += level; count += 1; peak = max(peak, level)
            if let start = start, now - start >= 2000 { detected = true }
        } else if detected {
            if quietSince == nil { quietSince = now }
            if let quietSince = quietSince, now - quietSince >= 2500 { flush(at: quietSince) }
            else { sum += level; count += 1 }
        } else { reset() }
    }
    public func flush(at now: Double) {
        if detected, let start = start, count > 0 {
            emit(SoundObservation(startMs: start, endMs: max(start, min(now, quietSince ?? now)), avgLevel: sum / Double(count), maxLevel: peak))
        }
        reset(); last = nil
    }
    private func reset() { start = nil; quietSince = nil; sum = 0; count = 0; peak = 0; detected = false }
}
