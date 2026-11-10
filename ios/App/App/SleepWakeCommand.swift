import ActivityKit
import Foundation
import Security

// The widget does not link this file or have access to the app's Keychain.
struct SleepWakeSession: Codable {
    let userId: UUID
    let accessToken: String
    let expiresAt: Double
    let url: URL
    let anonKey: String

    var usable: Bool {
        guard expiresAt.isFinite, expiresAt > Date().timeIntervalSince1970,
              url.scheme == "https", url.host?.hasSuffix(".supabase.co") == true,
              url.port == nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/",
              !anonKey.isEmpty, accessToken.utf8.count <= 8192 else { return false }
        // Match the mirrored token to the account. Supabase verifies the
        // signature and authorizes the actual write; this is only local fencing.
        let parts = accessToken.split(separator: ".")
        guard parts.count == 3 else { return false }
        var payload = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        payload += String(repeating: "=", count: (4 - payload.count % 4) % 4)
        guard let data = Data(base64Encoded: payload),
              let claims = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let subject = claims["sub"] as? String, UUID(uuidString: subject) == userId,
              let expiry = claims["exp"] as? Double, expiry > Date().timeIntervalSince1970 else { return false }
        return true
    }
}

@MainActor
enum SleepWakeCredentials {
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "no.strandeconsulting.sleepy.live-activity",
        kSecAttrAccount as String: "supabase-access",
        kSecAttrSynchronizable as String: false
    ]
    private(set) static var generation = 0
    private static var blocked = false

    static func replace(_ value: SleepWakeSession) throws {
        // A token rotation for the same account need not invalidate a request
        // already authenticated with the previous still-valid access token.
        if read()?.userId != value.userId { try clear() }
        guard value.usable else { try clear(); throw SleepWakeFailure.authentication }
        let data = try JSONEncoder().encode(value)
        var attributes = query
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        let result = status == errSecDuplicateItem
            ? SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
            : status
        guard result == errSecSuccess else { try clear(); throw SleepWakeFailure.authentication }
        blocked = false
    }

    static func clear() throws {
        generation += 1
        blocked = true
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw SleepWakeFailure.authentication }
    }

    static func read() -> SleepWakeSession? {
        guard !blocked else { return nil }
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var value: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &value) == errSecSuccess, let data = value as? Data else { return nil }
        return try? JSONDecoder().decode(SleepWakeSession.self, from: data)
    }
}

// Refuse redirects so the user bearer token cannot leave the configured origin.
private final class SleepWakeNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@available(iOS 16.2, *)
@MainActor
enum SleepWakeCommand {
    private static let operation = SleepWakeOperation()
    private static let network: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 10
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: SleepWakeNoRedirect(), delegateQueue: nil)
    }()

    private struct EndedRow: Decodable {
        let id: UUID
        let baby_id: UUID
        let endtime: String?
        let deleted_at: String?
    }

    static func run(sleepId rawID: String, activityID: String, endedAt: Date) async {
        guard let sleepId = UUID(uuidString: rawID),
              let activity = Activity<SleepActivityAttributes>.activities.first(where: {
                  $0.id == activityID && UUID(uuidString: $0.attributes.sleepId) == sleepId &&
                  $0.activityState == .active && $0.attributes.presentationEndsAt > endedAt
              }), let babyID = UUID(uuidString: activity.attributes.babyId) else { return }
        let coordinator = SleepLiveActivityCoordinator.shared
        let generation = SleepWakeCredentials.generation
        let owner = coordinator.ownerID
        await operation.run(sleepId: sleepId, confirm: {
            guard let session = SleepWakeCredentials.read(), session.usable, session.userId == owner else {
                throw SleepWakeFailure.authentication
            }
            var request = URLRequest(url: session.url.appendingPathComponent("rest").appendingPathComponent("v1")
                .appendingPathComponent("rpc").appendingPathComponent("end_sleep"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(session.anonKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer " + session.accessToken, forHTTPHeaderField: "Authorization")
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            request.httpBody = try JSONSerialization.data(withJSONObject: [
                "p_sleep_id": rawID, "p_ended_at": formatter.string(from: endedAt)
            ])
            let (data, response) = try await network.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw SleepWakeFailure.unconfirmed }
            if http.statusCode == 401 || http.statusCode == 403 { throw SleepWakeFailure.authentication }
            guard http.statusCode == 200, data.count <= 65536,
                  let rows = try? JSONDecoder().decode([EndedRow].self, from: data), rows.count == 1,
                  let row = rows.first, row.id == sleepId, row.baby_id == babyID, row.deleted_at == nil,
                  let end = row.endtime, SleepLiveActivityCoordinator.parseDate(end) != nil else {
                throw SleepWakeFailure.unconfirmed
            }
            guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else {
                throw SleepWakeFailure.authentication
            }
        }, stopSound: {
            if let owner { SleepySoundMeterPlugin.stopConfirmedSleep(sleepId: sleepId, ownerId: owner) }
        }, dismiss: {
            await coordinator.enqueue {
                guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else { return }
                await coordinator.finishConfirmedWake(sleepId: rawID)
            }
        }, report: { failure in
            await coordinator.enqueue {
                guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else { return }
                await coordinator.showWakeFailure(activityID: activityID, failure: failure)
            }
        })
    }
}
