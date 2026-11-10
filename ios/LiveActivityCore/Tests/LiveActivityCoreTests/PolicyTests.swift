import XCTest
@testable import LiveActivityCore

final class PolicyTests: XCTestCase {
    func testReuseDeduplicateAndEndStaleWithoutTouchingOtherBabies() {
        let plan = SleepActivityPolicy.plan(active: ["A", "B"], existing: [
            .init(id: "1", sleepId: "A", ongoing: true), .init(id: "2", sleepId: "A", ongoing: true),
            .init(id: "3", sleepId: "old", ongoing: true), .init(id: "4", sleepId: "B", ongoing: true)], attempted: [], mayRequest: true)
        XCTAssertEqual(plan.end, ["2", "3"]); XCTAssertTrue(plan.request.isEmpty)
    }
    func testNewSleepCanStartButOnlyWhileAllowed() {
        XCTAssertEqual(SleepActivityPolicy.plan(active: ["A"], existing: [], attempted: [], mayRequest: true).request, ["A"])
        XCTAssertTrue(SleepActivityPolicy.plan(active: ["A"], existing: [], attempted: [], mayRequest: false).request.isEmpty)
    }
    func testDismissalTerminationAndEightHoursNeverRenewSleep() {
        XCTAssertEqual(SleepActivityPolicy.maximumLifetime, 28800)
        XCTAssertTrue(SleepActivityPolicy.plan(active: ["A"], existing: [], attempted: ["A"], mayRequest: true).request.isEmpty)
        let ended = SleepActivityPolicy.plan(active: ["A"], existing: [.init(id: "1", sleepId: "A", ongoing: false)], attempted: [], mayRequest: true)
        XCTAssertEqual(ended.end, ["1"]); XCTAssertTrue(ended.request.isEmpty)
    }
    func testEmptyAuthoritativeSnapshotEndsAll() {
        let plan = SleepActivityPolicy.plan(active: [], existing: [.init(id: "1", sleepId: "A", ongoing: true)], attempted: ["A"], mayRequest: true)
        XCTAssertEqual(plan.end, ["1"]); XCTAssertTrue(plan.request.isEmpty)
    }
}
