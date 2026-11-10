// Continuous audio capture remains valid only while this narrow lease can be
// rechecked. These native deadlines include offline/network-failure behavior.
public enum RemoteValidityPolicy {
    public static let pollMs = 20000.0
    public static let watchdogMs = 12000.0
    public static let networkTimeoutSeconds = 10.0
    public static func shouldPoll(now: Double, lastAttempt: Double, pending: Bool) -> Bool {
        !pending && now - lastAttempt >= pollMs
    }
    public static func timedOut(now: Double, started: Double, pending: Bool) -> Bool {
        pending && now - started > watchdogMs
    }
}
