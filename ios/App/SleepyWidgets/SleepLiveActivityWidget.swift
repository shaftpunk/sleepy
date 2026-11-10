import ActivityKit
import WidgetKit
import SwiftUI

struct SleepLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SleepActivityAttributes.self) { context in
            SleepLockScreen(context: context)
                .widgetURL(URL(string: "sleepy://active-sleep"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label("Sleepy", systemImage: "moon.zzz.fill")
                        .font(.caption.weight(.semibold)).foregroundStyle(SleepyActivityColors.lavender)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SleepElapsed(attributes: context.attributes)
                        .font(.title3.weight(.semibold)).foregroundStyle(SleepyActivityColors.darkText)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 8) {
                            SleepIdentity(context: context)
                                .font(.headline).foregroundStyle(SleepyActivityColors.darkText)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            SleepWakeButton(context: context, accent: SleepyActivityColors.lavender)
                        }
                        if let failure = context.state.wakeFailure, !context.isStale {
                            SleepWakeFeedback(failure: failure).foregroundStyle(SleepyActivityColors.darkMuted)
                        } else {
                            SleepSoundStatus(active: context.state.soundMonitoringActive, stale: context.isStale)
                                .font(.caption).foregroundStyle(SleepyActivityColors.darkMuted)
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                SleepIslandIcon()
            } compactTrailing: {
                SleepElapsed(attributes: context.attributes).font(.caption2).frame(width: 52)
                    .foregroundStyle(SleepyActivityColors.darkText)
            } minimal: {
                SleepIslandIcon()
            }
            .widgetURL(URL(string: "sleepy://active-sleep"))
            .keylineTint(SleepyActivityColors.purple)
        }
    }
}

// Exact existing app colors from App.css and Settings.css. The Lock Screen
// follows the system appearance; the Dynamic Island keeps its system black.
private enum SleepyActivityColors {
    static let lightBackground = Color(red: 244 / 255, green: 239 / 255, blue: 250 / 255) // #f4effa
    static let darkBackground = Color(red: 44 / 255, green: 33 / 255, blue: 67 / 255) // #2c2143
    static let lightText = Color(red: 38 / 255, green: 31 / 255, blue: 50 / 255) // #261f32
    static let darkText = Color(red: 247 / 255, green: 244 / 255, blue: 255 / 255) // #f7f4ff
    static let lightMuted = Color(red: 105 / 255, green: 93 / 255, blue: 120 / 255) // #695d78
    static let darkMuted = Color(red: 185 / 255, green: 175 / 255, blue: 201 / 255) // #b9afc9
    static let lightAccent = Color(red: 93 / 255, green: 71 / 255, blue: 126 / 255) // #5d477e
    static let lavender = Color(red: 212 / 255, green: 198 / 255, blue: 255 / 255) // #d4c6ff
    static let purple = Color(red: 143 / 255, green: 116 / 255, blue: 223 / 255) // #8f74df
}

private struct SleepLockScreen: View {
    @Environment(\.colorScheme) private var colorScheme
    let context: ActivityViewContext<SleepActivityAttributes>
    private var isDark: Bool { colorScheme == .dark }
    private var accent: Color { isDark ? SleepyActivityColors.lavender : SleepyActivityColors.lightAccent }
    private var muted: Color { isDark ? SleepyActivityColors.darkMuted : SleepyActivityColors.lightMuted }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Label("Sleepy", systemImage: "moon.zzz.fill")
                        .font(.caption.weight(.semibold)).foregroundStyle(accent)
                    SleepIdentity(context: context).font(.subheadline.weight(.semibold))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                SleepElapsed(attributes: context.attributes)
                    .font(.system(.title, design: .rounded).weight(.semibold))
                    .frame(maxWidth: 132, alignment: .trailing)
            }
            if let failure = context.state.wakeFailure, !context.isStale {
                SleepWakeFeedback(failure: failure).foregroundStyle(muted)
            } else if let wake = context.state.estimatedWakeTime, !context.isStale, wake > context.attributes.startedAt {
                SleepNapProgress(start: context.attributes.startedAt, wake: wake, accent: accent)
                    .foregroundStyle(muted)
            }
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    started
                    sound
                }
                .font(.caption).foregroundStyle(muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                SleepWakeButton(context: context, accent: accent)
            }
        }
        .foregroundStyle(isDark ? SleepyActivityColors.darkText : SleepyActivityColors.lightText)
        .padding(14)
        .activityBackgroundTint(isDark ? SleepyActivityColors.darkBackground : SleepyActivityColors.lightBackground)
        .activitySystemActionForegroundColor(accent)
    }

    private var started: some View {
        HStack(spacing: 4) {
            Text("sleep_started")
            Text(context.attributes.startedAt, style: .time)
        }.accessibilityElement(children: .combine)
    }

    private var sound: some View {
        SleepSoundStatus(active: context.state.soundMonitoringActive, stale: context.isStale)
    }
}

private struct SleepNapProgress: View {
    let start: Date
    let wake: Date
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ProgressView(timerInterval: start...wake, countsDown: false)
                .tint(accent)
                .accessibilityLabel(Text("estimated_progress"))
            HStack(spacing: 4) {
                if #available(iOS 18.0, *) {
                    Text("estimated_wake")
                    Text(.currentDate, format: SystemFormatStyle.DateReference(to: wake))
                } else {
                    Text("estimated_time_left")
                    Text(timerInterval: start...wake, pauseTime: wake, countsDown: true, showsHours: true)
                }
            }
            .font(.caption)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            .accessibilityElement(children: .combine)
        }
    }
}

private struct SleepWakeButton: View {
    let context: ActivityViewContext<SleepActivityAttributes>
    let accent: Color

    var body: some View {
        if #available(iOS 17.0, *), !context.isStale {
            Button(intent: WakeSleepIntent(sleepId: context.attributes.sleepId, activityID: context.activityID)) {
                Text("wake_sleep")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .frame(minHeight: 32)
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.bordered)
            .tint(accent)
            .accessibilityLabel(Text("wake_sleep"))
        }
    }
}

private struct SleepWakeFeedback: View {
    let failure: SleepWakeFailure
    var body: some View {
        Label {
            Text(LocalizedStringKey(failure == .authentication ? "wake_auth" : "wake_unconfirmed"))
        } icon: {
            Image(systemName: "exclamationmark.circle")
        }
        .font(.caption)
        .lineLimit(2)
    }
}

private struct SleepIslandIcon: View {
    var body: some View {
        Image(systemName: "moon.zzz.fill")
            .foregroundStyle(SleepyActivityColors.lavender)
            .accessibilityLabel(Text("sleep_activity"))
    }
}

private struct SleepIdentity: View {
    let context: ActivityViewContext<SleepActivityAttributes>
    var body: some View {
        if context.isStale {
            Text("sleep_check_app").lineLimit(2)
        } else {
            Text(String.localizedStringWithFormat(NSLocalizedString("baby_sleeping", comment: "Baby name followed by sleeping"), context.attributes.babyName))
                .lineLimit(2).minimumScaleFactor(0.85)
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
