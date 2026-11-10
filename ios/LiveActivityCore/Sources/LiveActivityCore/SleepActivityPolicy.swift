import Foundation

// Presentation lifecycle only. Active IDs must come from a successful database
// read; this policy cannot start/end a Sleepy sleep or infer one from a timer.
public enum SleepActivityPolicy {
    public static let maximumLifetime: TimeInterval = 8 * 60 * 60
    public struct Existing {
        public let id: String
        public let sleepId: String
        public let ongoing: Bool
        public init(id: String, sleepId: String, ongoing: Bool) { self.id = id; self.sleepId = sleepId; self.ongoing = ongoing }
    }
    public struct Plan {
        public let end: Set<String>
        public let request: Set<String>
    }
    public static func plan(active: Set<String>, existing: [Existing], attempted: Set<String>, mayRequest: Bool) -> Plan {
        var keep = Set<String>(), end = Set<String>()
        for record in existing.sorted(by: { $0.id < $1.id }) {
            if !active.contains(record.sleepId) || !record.ongoing || keep.contains(record.sleepId) { end.insert(record.id) }
            else { keep.insert(record.sleepId) }
        }
        // A dismissed/expired activity never renews automatically for this sleep.
        let seen = Set(existing.map(\.sleepId)).union(attempted)
        return Plan(end: end, request: mayRequest ? active.subtracting(keep).subtracting(seen) : [])
    }
}
