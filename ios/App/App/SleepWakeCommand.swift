import ActivityKit
import Foundation
import Security
import os

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
    static var requestRefresh: ((UUID, Bool) -> Void)?
    private static let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "no.strandeconsulting.sleepy.live-activity",
        kSecAttrAccount as String: "supabase-access",
        kSecAttrSynchronizable as String: false
    ]
    private(set) static var generation = 0
    private static var blocked = false
    private static var lastOwner: UUID?
    private struct Waiter {
        let owner: UUID
        let excludingToken: String?
        let continuation: CheckedContinuation<SleepWakeSession?, Never>
    }
    private static var waiters: [UUID: Waiter] = [:]

    static func replace(_ value: SleepWakeSession) throws {
        // A token rotation for the same account need not invalidate a request
        // already authenticated with the previous still-valid access token.
        if let previous = read()?.userId ?? lastOwner, previous != value.userId { try clear() }
        guard value.usable else { try clear(); throw SleepWakeFailure.authentication }
        if let prior = read(), prior.userId == value.userId, prior.usable, prior.expiresAt > value.expiresAt { return }
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
        lastOwner = value.userId
        for (id, waiter) in waiters where waiter.owner == value.userId && waiter.excludingToken != value.accessToken {
            waiters.removeValue(forKey: id)?.continuation.resume(returning: value)
        }
    }

    static func clear() throws {
        generation += 1
        blocked = true
        lastOwner = nil
        let pending = waiters; waiters.removeAll()
        for waiter in pending.values { waiter.continuation.resume(returning: nil) }
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
        let session = try? JSONDecoder().decode(SleepWakeSession.self, from: data)
        if let session { lastOwner = session.userId }
        return session
    }
    static func fresh(owner: UUID, excludingToken: String? = nil) async throws -> SleepWakeSession {
        func candidate() -> SleepWakeSession? {
            guard let session = read(), session.usable, session.userId == owner, session.accessToken != excludingToken else { return nil }
            return session
        }
        if let session = candidate() { return session }
        let version = generation, id = UUID()
        // Best effort only: iOS may not run the WebView while the app is hidden.
        // No background polling, native refresh token, or auth bypass is added.
        let refreshed: SleepWakeSession? = await withCheckedContinuation { continuation in
            waiters[id] = Waiter(owner: owner, excludingToken: excludingToken, continuation: continuation)
            requestRefresh?(owner, excludingToken != nil)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                Task { @MainActor in waiters.removeValue(forKey: id)?.continuation.resume(returning: nil) }
            }
        }
        guard generation == version, let refreshed, refreshed.usable, refreshed.userId == owner else { throw SleepWakeFailure.authentication }
        return refreshed
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
    private static let log = Logger(subsystem: "no.strandeconsulting.sleepy", category: "LiveActivityWake")
    private static let network: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 10
        config.urlCache = nil
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: SleepWakeNoRedirect(), delegateQueue: nil)
    }()

    static func run(sleepId rawID: String, activityID: String, endedAt: Date) async {
        guard let sleepId = UUID(uuidString: rawID),
              let activity = Activity<SleepActivityAttributes>.activities.first(where: {
                  $0.id == activityID && UUID(uuidString: $0.attributes.sleepId) == sleepId &&
                  ($0.activityState == .active || $0.activityState == .stale)
              }), let babyID = UUID(uuidString: activity.attributes.babyId) else { return }
        let coordinator = SleepLiveActivityCoordinator.shared
        let generation = SleepWakeCredentials.generation
        let owner = coordinator.ownerID
        await operation.run(sleepId: sleepId, confirm: {
            guard let owner else {
                log.info("Wake owner context unavailable")
                throw SleepWakeFailure.authentication
            }
            if let prior = SleepWakeCredentials.read() {
                if prior.userId != owner { log.info("Wake credential owner mismatch") }
                else if prior.expiresAt <= Date().timeIntervalSince1970 { log.info("Mirrored Wake access token expired; requesting JS recovery") }
                else if !prior.usable { log.info("Mirrored Wake credential validation failed") }
            } else { log.info("Wake credential missing or Keychain unavailable; requesting JS recovery") }
            var session = try await SleepWakeCredentials.fresh(owner: owner)
            let transport = SleepWakeHTTPClient(network: network)
            for attempt in 0..<2 {
                guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else { throw SleepWakeFailure.authentication }
                do {
                    try await transport.confirm(base: session.url, anonKey: session.anonKey, token: session.accessToken,
                        sleep: sleepId, baby: babyID, endedAt: endedAt)
                    break
                } catch SleepWakeHTTPError.expiredToken {
                    guard attempt == 0 else { throw SleepWakeFailure.authentication }
                    log.info("Wake token rejected; requesting current JS-owned session")
                    session = try await SleepWakeCredentials.fresh(owner: owner, excludingToken: session.accessToken)
                } catch SleepWakeFailure.authentication {
                    log.info("Wake RPC denied access and no ended row could be confirmed")
                    throw SleepWakeFailure.authentication
                }
            }
            guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else {
                throw SleepWakeFailure.authentication
            }
        }, stopSound: {
            log.info("Authoritative sleep end confirmed")
            if let owner { SleepySoundMeterPlugin.stopConfirmedSleep(sleepId: sleepId, ownerId: owner) }
        }, dismiss: {
            await coordinator.enqueue {
                guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else { return }
                await coordinator.finishConfirmedWake(sleepId: rawID)
            }
        }, report: { failure in
            if failure == .authentication { log.info("Wake authentication unavailable or access denied; activity retained") }
            else { log.info("Wake could not be confirmed; activity retained") }
            await coordinator.enqueue {
                guard generation == SleepWakeCredentials.generation, coordinator.ownerID == owner else { return }
                await coordinator.showWakeFailure(activityID: activityID, failure: failure)
            }
        })
    }
}
