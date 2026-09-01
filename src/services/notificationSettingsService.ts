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