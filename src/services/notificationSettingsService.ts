import { supabase } from "../lib/supabase";
import { useAppStore, type BabyId } from "../stores/appStore";
import { translate, type TranslationKey } from "../i18n";

function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(useAppStore.getState().language, key, params);
}

export interface NotificationSettings {
  id: string;
  bbyid: BabyId;
  feeding_reminder_enabled: boolean;
  feeding_reminder_minutes: number;
  last_feeding_notification_for: string | null;
  created_at: string;
  updated_at: string;
}

export async function getNotificationSettings(
  bbyid: BabyId,
): Promise<NotificationSettings> {
  const { data, error } = await supabase
    .from("notification_settings")
    .select("*")
    .eq("bbyid", bbyid)
    .maybeSingle();

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotLoadDetailed", { error: error.message }),
    );
  }

  if (data) {
    return data as NotificationSettings;
  }

  const { data: created, error: createError } =
    await supabase
      .from("notification_settings")
      .insert({
        bbyid,
        feeding_reminder_enabled: false,
        feeding_reminder_minutes: 180,
      })
      .select("*")
      .single();

  if (createError) {
    throw new Error(
      t("notifications.errorCouldNotCreateSettings", { error: createError.message }),
    );
  }

  return created as NotificationSettings;
}

export async function updateFeedingReminder(
  bbyid: BabyId,
  enabled: boolean,
): Promise<void> {
  const { error } = await supabase
    .from("notification_settings")
    .update({
      feeding_reminder_enabled: enabled,
      updated_at: new Date().toISOString(),
    })
    .eq("bbyid", bbyid);

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotUpdateFeedingReminderDetailed", { error: error.message }),
    );
  }
}

export async function updateFeedingReminderMinutes(
  bbyid: BabyId,
  minutes: number,
): Promise<void> {
  const { error } = await supabase
    .from("notification_settings")
    .update({
      feeding_reminder_minutes: minutes,
      updated_at: new Date().toISOString(),
    })
    .eq("bbyid", bbyid);

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotUpdateReminderIntervalDetailed", { error: error.message }),
    );
  }
}

/*
 * Sleep start / wake-up push notifications - Sleepy 3.0.
 *
 * Unlike the feeding reminder settings above (still keyed by the legacy
 * bbyid), these are keyed by the signed-in user's UUID plus the baby's UUID
 * (notification_settings.user_id / .baby_id), so each household member can
 * independently choose whether they want to be notified for a given baby.
 */
export interface SleepEventNotificationSettings {
  notify_sleep_started: boolean;
  notify_sleep_ended: boolean;
}

const DEFAULT_SLEEP_EVENT_SETTINGS: SleepEventNotificationSettings = {
  notify_sleep_started: false,
  notify_sleep_ended: false,
};

export async function getSleepEventNotificationSettings(
  userId: string,
  babyId: string,
): Promise<SleepEventNotificationSettings> {
  const { data, error } = await supabase
    .from("notification_settings")
    .select("notify_sleep_started, notify_sleep_ended")
    .eq("user_id", userId)
    .eq("baby_id", babyId)
    .maybeSingle();

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotLoadDetailed", { error: error.message }),
    );
  }

  return data
    ? {
        notify_sleep_started: data.notify_sleep_started,
        notify_sleep_ended: data.notify_sleep_ended,
      }
    : DEFAULT_SLEEP_EVENT_SETTINGS;
}

export async function updateSleepEventNotificationSettings(
  userId: string,
  babyId: string,
  updates: Partial<SleepEventNotificationSettings>,
): Promise<void> {
  const { error } = await supabase.from("notification_settings").upsert(
    {
      user_id: userId,
      baby_id: babyId,
      ...updates,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "user_id,baby_id",
    },
  );

  if (error) {
    throw new Error(
      t("notifications.errorCouldNotUpdateDetailed", { error: error.message }),
    );
  }
}