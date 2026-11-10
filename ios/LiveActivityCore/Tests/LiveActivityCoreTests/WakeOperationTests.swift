import Foundation
import XCTest
@testable import LiveActivityCore

final class WakeOperationTests: XCTestCase {
    @MainActor
    func testConfirmedWakeWithoutWebViewStopsSoundBeforeDismissal() async {
        var events: [String] = []
        await SleepWakeOperation().run(sleepId: UUID(), confirm: { events.append("database confirmed") },
            stopSound: { events.append("sound stopped") }, dismiss: { events.append("dismissed") },
            report: { _ in XCTFail("Unexpected failure") })
        XCTAssertEqual(events, ["database confirmed", "sound stopped", "dismissed"])
    }

    @MainActor
    func testOfflineTimeoutAuthAndServerErrorsDoNotStopOrDismiss() async {
        let cases: [(Error, SleepWakeFailure)] = [
            (URLError(.notConnectedToInternet), .unconfirmed),
            (URLError(.timedOut), .unconfirmed),
            (SleepWakeFailure.authentication, .authentication),
            (URLError(.badServerResponse), .unconfirmed)
        ]
        for (error, expected) in cases {
            var failure: SleepWakeFailure?
            await SleepWakeOperation().run(sleepId: UUID(), confirm: { throw error },
                stopSound: { XCTFail("Stopped unconfirmed sleep") }, dismiss: { XCTFail("Dismissed unconfirmed sleep") },
                report: { failure = $0 })
            XCTAssertEqual(failure, expected)
        }
    }

    @MainActor
    func testDuplicateTapWhileConfirmingExecutesOnce() async {
        let operation = SleepWakeOperation()
        let sleep = UUID()
        var gate: CheckedContinuation<Void, Never>?
        var stops = 0
        let first = Task { @MainActor in
            await operation.run(sleepId: sleep,
                confirm: { await withCheckedContinuation { gate = $0 } },
                stopSound: { stops += 1 }, dismiss: {}, report: { _ in XCTFail("Unexpected failure") })
        }
        while gate == nil { await Task.yield() }
        await operation.run(sleepId: sleep, confirm: { XCTFail("Duplicate RPC") },
            stopSound: { stops += 1 }, dismiss: { XCTFail("Duplicate dismissal") }, report: { _ in })
        gate?.resume()
        await first.value
        XCTAssertEqual(stops, 1)
    }
}
