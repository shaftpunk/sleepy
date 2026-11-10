import ActivityKit
import WidgetKit
import SwiftUI

struct SleepLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SleepActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .center, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Sleepy", systemImage: "moon.zzz.fill").font(.caption.weight(.semibold))
                        SleepIdentity(context: context)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    SleepElapsed(attributes: context.attributes).font(.title2.weight(.semibold))
                        .frame(maxWidth: 110, alignment: .trailing)
                }
                HStack(spacing: 4) {
                    Text("sleep_started")
                    Text(context.attributes.startedAt, style: .time)
                }.font(.caption).foregroundStyle(.secondary)
                SleepSoundStatus(active: context.state.soundMonitoringActive, stale: context.isStale).font(.caption)
            }
            .padding(14)
            .activityBackgroundTint(Color(uiColor: .secondarySystemBackground))
            .activitySystemActionForegroundColor(Color(uiColor: .label))
            .widgetURL(URL(string: "sleepy://active-sleep"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Sleepy", systemImage: "moon.zzz.fill").font(.headline).foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SleepElapsed(attributes: context.attributes).font(.headline).foregroundStyle(.white)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        SleepIdentity(context: context).foregroundStyle(.white)
                        SleepSoundStatus(active: context.state.soundMonitoringActive, stale: context.isStale).foregroundStyle(.white.opacity(0.85))
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: "moon.zzz.fill").foregroundStyle(.purple).accessibilityLabel(Text("sleep_activity"))
            } compactTrailing: {
                SleepElapsed(attributes: context.attributes).font(.caption2).frame(width: 52).foregroundStyle(.white)
            } minimal: {
                Image(systemName: "moon.zzz.fill").foregroundStyle(.purple).accessibilityLabel(Text("sleep_activity"))
            }
            .widgetURL(URL(string: "sleepy://active-sleep"))
            .keylineTint(.purple)
        }
    }
}

private struct SleepIdentity: View {
    let context: ActivityViewContext<SleepActivityAttributes>
    var body: some View {
        if context.isStale {
            Text("sleep_check_app").font(.subheadline).lineLimit(2)
        } else {
            Text(String.localizedStringWithFormat(NSLocalizedString("baby_sleeping", comment: "Baby name followed by sleeping"), context.attributes.babyName))
                .font(.subheadline.weight(.medium)).lineLimit(2).minimumScaleFactor(0.85)
        }
    }
}
private struct SleepElapsed: View {
    let attributes: SleepActivityAttributes
    var body: some View {
        Text(timerInterval: attributes.startedAt...attributes.presentationEndsAt, countsDown: false, showsHours: true)
            .monospacedDigit().minimumScaleFactor(0.75).lineLimit(1)
            .accessibilityLabel(Text("sleep_elapsed"))
            .accessibilityValue(Text(timerInterval: attributes.startedAt...attributes.presentationEndsAt, countsDown: false, showsHours: true))
    }
}
private struct SleepSoundStatus: View {
    let active: Bool
    let stale: Bool
    var body: some View {
        Label {
            Text(LocalizedStringKey(stale ? "sleep_check_app" : active ? "sound_active" : "sound_off"))
        } icon: {
            Image(systemName: active && !stale ? "mic.fill" : "mic.slash.fill")
        }.lineLimit(2)
    }
}
