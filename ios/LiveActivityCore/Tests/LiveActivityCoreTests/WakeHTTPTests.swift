import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import LiveActivityCore

private final class WakeStubProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, data) = try Self.handler!(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

@available(macOS 12.0, *)
final class WakeHTTPTests: XCTestCase {
    let sleep = UUID(), baby = UUID()
    func transport() -> SleepWakeHTTPClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [WakeStubProtocol.self]
        return SleepWakeHTTPClient(network: URLSession(configuration: config))
    }
    func row(id: UUID? = nil, babyID: UUID? = nil, ended: Bool = true) -> Data {
        try! JSONSerialization.data(withJSONObject: [["id": (id ?? sleep).uuidString,
            "baby_id": (babyID ?? baby).uuidString, "endtime": ended ? "2026-11-12T07:12:00+00:00" as Any : NSNull(), "deleted_at": NSNull()]])
    }
    func confirm(_ client: SleepWakeHTTPClient, at: Date = Date()) async throws {
        try await client.confirm(base: URL(string: "https://fixture.supabase.co")!, anonKey: "fixture-public", token: "fixture-access",
            sleep: sleep, baby: baby, endedAt: at)
    }
    func testValidOrAlreadyEndedRowConfirmsExactSleepAndAuthHeadersWithoutDurationCutoff() async throws {
        var calls = 0
        WakeStubProtocol.handler = { request in
            calls += 1
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/rest/v1/rpc/end_sleep")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer fixture-access")
            XCTAssertEqual(request.value(forHTTPHeaderField: "apikey"), "fixture-public")
            return (200, self.row())
        }
        // The transport has no sleep age limit and accepts an already-ended row.
        try await confirm(transport(), at: Date().addingTimeInterval(-2 * 3600))
        try await confirm(transport(), at: Date().addingTimeInterval(-12 * 3600))
        XCTAssertEqual(calls, 2)
    }
    func testLostRPCResponseRecoversOnlyFromExactAuthoritativeEndedRow() async throws {
        var methods: [String] = []
        WakeStubProtocol.handler = { request in
            methods.append(request.httpMethod!)
            if request.httpMethod == "POST" { throw URLError(.timedOut) }
            XCTAssertEqual(request.url?.path, "/rest/v1/sleep")
            XCTAssertTrue(request.url!.query!.contains("id=eq."))
            return (200, self.row())
        }
        try await confirm(transport())
        XCTAssertEqual(methods, ["POST", "GET"])
    }
    func testExpiredTokenRequestsRefreshAndDoesNotTreatFailureAsSuccess() async {
        var calls = 0
        WakeStubProtocol.handler = { _ in calls += 1; return (401, Data()) }
        do { try await confirm(transport()); XCTFail("Accepted expired JWT") }
        catch SleepWakeHTTPError.expiredToken {} catch { XCTFail("Unexpected error") }
        XCTAssertEqual(calls, 1)
    }
    func testUnauthorizedActiveSleepAndOfflineRemainUnconfirmed() async {
        for offline in [false, true] {
            WakeStubProtocol.handler = { request in
                if offline { throw URLError(.notConnectedToInternet) }
                return request.httpMethod == "POST" ? (403, Data()) : (200, self.row(ended: false))
            }
            do { try await confirm(transport()); XCTFail("Ended unauthorized/offline sleep") }
            catch let failure as SleepWakeFailure { XCTAssertEqual(failure, offline ? .unconfirmed : .authentication) }
            catch { XCTFail("Unexpected error") }
        }
    }
    func testMalformedWrongBabyWrongSleepAndStillActiveResponsesNeverConfirm() async {
        for data in [Data("{}".utf8), row(id: UUID()), row(babyID: UUID()), row(ended: false)] {
            WakeStubProtocol.handler = { _ in (200, data) }
            do { try await confirm(transport()); XCTFail("Accepted mismatched response") }
            catch { XCTAssertEqual(error as? SleepWakeFailure, .unconfirmed) }
        }
    }
}
