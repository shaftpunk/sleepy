import XCTest
@testable import NativeSoundCore

final class CoreTests: XCTestCase {
    struct Vector: Decodable {
        let name: String
        let threshold: Double
        let steps: [[Double]] // [timestamp, RMS]; negative RMS means explicit flush.
        let expected: [SoundObservation]
    }
    func testTypeScriptParityVectors() throws {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "detector-vectors", withExtension: "json"))
        let cases = try JSONDecoder().decode([Vector].self, from: Data(contentsOf: url))
        for vector in cases {
            var actual: [SoundObservation] = []
            let detector = NativeSoundDetector(threshold: vector.threshold) { actual.append($0) }
            for step in vector.steps {
                if step[1] < 0 { detector.flush(at: step[0]) } else { detector.sample(step[1], at: step[0]) }
            }
            XCTAssertEqual(actual.count, vector.expected.count, vector.name)
            for (a, b) in zip(actual, vector.expected) {
                XCTAssertEqual(a.startMs, b.startMs, vector.name); XCTAssertEqual(a.endMs, b.endMs, vector.name)
                XCTAssertEqual(a.avgLevel, b.avgLevel, accuracy: 1e-12, vector.name)
                XCTAssertEqual(a.maxLevel, b.maxLevel, accuracy: 1e-12, vector.name)
            }
        }
    }
    func testMetadataQueueDurabilityIdempotencyAndUserIsolation() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let url = root.appendingPathComponent("metadata.json")
        let queue = try NativeSoundEventQueue(url: url)
        let session = SoundSession(runId: "run", userId: "A", babyId: "baby", sleepId: "sleep", threshold: 0.06)
        let event = NativeSoundEvent(session: session, observation: SoundObservation(startMs: 0, endMs: 2000, avgLevel: 0.1, maxLevel: 0.2))
        try queue.append(event); try queue.append(event)
        XCTAssertEqual(queue.events.count, 1)
        let restored = try NativeSoundEventQueue(url: url)
        XCTAssertEqual(restored.events, [event])
        try restored.acknowledge(userId: "B", ids: [event.id]); XCTAssertEqual(restored.events.count, 1)
        try restored.acknowledge(userId: "A", ids: [event.id]); XCTAssertTrue(restored.events.isEmpty)
        let data = try JSONSerialization.jsonObject(with: JSONEncoder().encode(event)) as! [String: Any]
        XCTAssertEqual(Set(data.keys), Set(["id", "session", "observation"]))
        let metadata = data["observation"] as! [String: Any]
        XCTAssertEqual(Set(metadata.keys), Set(["startMs", "endMs", "avgLevel", "maxLevel"]))
    }
    func testBoundedQueueNeverEvictsUnacknowledgedEvents() throws {
        let queue = try NativeSoundEventQueue()
        let session = SoundSession(runId: "run", userId: "user", babyId: "baby", sleepId: "sleep", threshold: 0.06)
        for _ in 0..<NativeSoundEventQueue.capacity {
            try queue.append(NativeSoundEvent(session: session, observation: SoundObservation(startMs: 0, endMs: 2000, avgLevel: 0.1, maxLevel: 0.2)))
        }
        XCTAssertThrowsError(try queue.append(NativeSoundEvent(session: session, observation: SoundObservation(startMs: 1, endMs: 2001, avgLevel: 0.1, maxLevel: 0.2))))
        XCTAssertEqual(queue.events.count, NativeSoundEventQueue.capacity)
    }
    func testBackgroundLockAndInterruptionIntent() {
        let intent = MonitoringIntent(); intent.begin(); intent.background()
        XCTAssertTrue(intent.requested); XCTAssertFalse(intent.foreground)
        intent.activate(); XCTAssertTrue(intent.requested)
        intent.interruptionBegan(); XCTAssertFalse(intent.mayRecover)
        XCTAssertTrue(intent.interruptionEnded(shouldResume: true))
        intent.interruptionBegan(); intent.stop()
        XCTAssertFalse(intent.interruptionEnded(shouldResume: true))
        intent.begin(); intent.interruptionBegan(); XCTAssertFalse(intent.interruptionEnded(shouldResume: false))
        intent.stop(); XCTAssertFalse(intent.requested)
    }
    func testRemoteValidityDeadlineFailsClosedWithinSixtySeconds() {
        XCTAssertTrue(RemoteValidityPolicy.shouldPoll(now: 20000, lastAttempt: 0, pending: false))
        XCTAssertFalse(RemoteValidityPolicy.shouldPoll(now: 20000, lastAttempt: 0, pending: true))
        XCTAssertTrue(RemoteValidityPolicy.timedOut(now: 32001, started: 20000, pending: true))
        XCTAssertLessThan(RemoteValidityPolicy.pollMs + RemoteValidityPolicy.watchdogMs + 4000, 60000)
        XCTAssertFalse(RemoteValidityPolicy.timedOut(now: 1000, started: 0, pending: true))
    }
}
