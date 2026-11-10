// User intent is independent of foreground visibility and interruption state.
public final class MonitoringIntent {
    public private(set) var requested = false
    public private(set) var interrupted = false
    public private(set) var foreground = true
    public init() {}
    public func begin() { requested = true }
    public func stop() { requested = false }
    public func background() { foreground = false }
    public func activate() { foreground = true }
    public func interruptionBegan() { interrupted = true }
    public func interruptionEnded(shouldResume: Bool) -> Bool {
        interrupted = false
        return requested && shouldResume
    }
    public var mayRecover: Bool { requested && !interrupted }
}
