import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

enum SleepWakeFailure: String, Error, Codable, Hashable {
    case authentication, unconfirmed
}

// One in-flight command per sleep. Both side effects are strictly downstream
// of an authoritative confirmation, never a tap or a local estimate.
@MainActor
final class SleepWakeOperation {
    private var inFlight = Set<UUID>()

    func run(
        sleepId: UUID,
        confirm: @MainActor () async throws -> Void,
        stopSound: @MainActor () -> Void,
        dismiss: @MainActor () async -> Void,
        report: @MainActor (SleepWakeFailure) async -> Void
    ) async {
        guard inFlight.insert(sleepId).inserted else { return }
        defer { inFlight.remove(sleepId) }
        do {
            try await confirm()
            stopSound()
            await dismiss()
        } catch {
            await report(error as? SleepWakeFailure ?? .unconfirmed)
        }
    }
}

#if !SLEEPY_WIDGET_EXTENSION
enum SleepWakeHTTPError: Error { case expiredToken }

// No stored credentials or refresh token. Only the app links this transport.
// A lost RPC response may follow a committed write: a caller-authorized read can
// confirm an ended row, but an unavailable/active/wrong row never counts as success.
@available(iOS 15.0, macOS 12.0, *)
struct SleepWakeHTTPClient {
    let network: URLSession
    private struct EndedRow: Decodable {
        let id: UUID
        let baby_id: UUID
        let endtime: String?
        let deleted_at: String?
    }
    private func confirmed(_ data: Data, sleep: UUID, baby: UUID) -> Bool {
        guard data.count <= 65536, let rows = try? JSONDecoder().decode([EndedRow].self, from: data), rows.count == 1,
              let row = rows.first, row.id == sleep, row.baby_id == baby, row.deleted_at == nil, let end = row.endtime else { return false }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if formatter.date(from: end) != nil { return true }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: end) != nil
    }
    func confirm(base: URL, anonKey: String, token: String, sleep: UUID, baby: UUID, endedAt: Date) async throws {
        let rest = base.appendingPathComponent("rest").appendingPathComponent("v1")
        func request(_ url: URL) -> URLRequest {
            var result = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
            result.setValue(anonKey, forHTTPHeaderField: "apikey")
            result.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
            return result
        }
        var post = request(rest.appendingPathComponent("rpc").appendingPathComponent("end_sleep"))
        post.httpMethod = "POST"
        post.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        post.httpBody = try JSONSerialization.data(withJSONObject: ["p_sleep_id": sleep.uuidString, "p_ended_at": formatter.string(from: endedAt)])
        var failure = SleepWakeFailure.unconfirmed
        do {
            let (data, response) = try await network.data(for: post)
            if let http = response as? HTTPURLResponse {
                if http.statusCode == 401 { throw SleepWakeHTTPError.expiredToken }
                if http.statusCode == 403 { failure = .authentication }
                if http.statusCode == 200, confirmed(data, sleep: sleep, baby: baby) { return }
            }
        } catch SleepWakeHTTPError.expiredToken { throw SleepWakeHTTPError.expiredToken }
        catch { /* Only an authoritative read can recover a lost response. */ }
        var components = URLComponents(url: rest.appendingPathComponent("sleep"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "select", value: "id,baby_id,endtime,deleted_at"),
            URLQueryItem(name: "id", value: "eq." + sleep.uuidString), URLQueryItem(name: "limit", value: "1")]
        var get = request(components.url!)
        get.timeoutInterval = 3
        do {
            let (data, response) = try await network.data(for: get)
            if let http = response as? HTTPURLResponse, http.statusCode == 200, confirmed(data, sleep: sleep, baby: baby) { return }
        } catch { /* Offline/unknown is never a confirmed sleep end. */ }
        throw failure
    }
}
#endif
