import { supabase } from "../lib/supabase";
import { useAppStore } from "../stores/appStore";
import { translate, type TranslationKey } from "../i18n";

function t(key: TranslationKey): string {
  return translate(useAppStore.getState().language, key);
}

export type FeedType = "bottle" | "breast" | "food";
export type FeedSide = "left" | "right" | "both" | null;

export type FeedRecord = {
  id: string;

  // Sleepy 3.0
  baby_id: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;

  feedtype: FeedType;
  side: FeedSide;
  amountml: number | null;
  starttime: string;
  endtime: string | null;
  durationminutes: number | null;
  note: string | null;

  created_at?: string;
  updated_at?: string;
};

export type FeedInput = {
  baby_id: string;
  feedtype: FeedType;
  side?: FeedSide;
  amountml?: number | null;
  starttime?: string;
  endtime?: string | null;
  durationminutes?: number | null;
  note?: string | null;
};

/**
 * Get the currently authenticated user's ID.
 */
async function getCurrentUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error(t("errors.mustBeLoggedIn"));
  }

  return user.id;
}

/**
 * Create a new feeding record.
 */
export async function createFeed(
  input: FeedInput,
): Promise<FeedRecord> {
  const userId = await getCurrentUserId();

  const { data, error } = await supabase
    .from("feed")
    .insert({
      baby_id: input.baby_id,

      feedtype: input.feedtype,
      side: input.side ?? null,
      amountml: input.amountml ?? null,

      starttime:
        input.starttime ??
        new Date().toISOString(),

      endtime: input.endtime ?? null,

      durationminutes:
        input.durationminutes ?? null,

      note: input.note ?? null,

      created_by_user_id: userId,
      updated_by_user_id: userId,

      deleted_at: null,
      deleted_by_user_id: null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as FeedRecord;
}

/**
 * Update an existing feeding record.
 */
export async function updateFeed(
  id: string,
  input: Partial<FeedInput>,
): Promise<FeedRecord> {
  const userId = await getCurrentUserId();

  const updates: Record<string, unknown> = {
    updated_by_user_id: userId,
    updated_at: new Date().toISOString(),
  };

  if (input.feedtype !== undefined) {
    updates.feedtype = input.feedtype;
  }

  if (input.side !== undefined) {
    updates.side = input.side;
  }

  if (input.amountml !== undefined) {
    updates.amountml = input.amountml;
  }

  if (input.starttime !== undefined) {
    updates.starttime = input.starttime;
  }

  if (input.endtime !== undefined) {
    updates.endtime = input.endtime;
  }

  if (input.durationminutes !== undefined) {
    updates.durationminutes =
      input.durationminutes;
  }

  if (input.note !== undefined) {
    updates.note = input.note;
  }

  const { data, error } = await supabase
    .from("feed")
    .update(updates)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as FeedRecord;
}

/**
 * Soft-delete a feeding record.
 *
 * The row remains in the database for audit/history,
 * but normal Sleepy queries will no longer return it.
 */
export async function deleteFeed(
  id: string,
): Promise<void> {
  const userId = await getCurrentUserId();

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("feed")
    .update({
      deleted_at: now,
      deleted_by_user_id: userId,
      updated_by_user_id: userId,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }
}

/**
 * Get the most recent feeding for a baby.
 */
export async function getLastFeed(
  babyId: string,
): Promise<FeedRecord | null> {
  const { data, error } = await supabase
    .from("feed")
    .select("*")
    .eq("baby_id", babyId)
    .is("deleted_at", null)
    .order("starttime", {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as FeedRecord | null;
}

/**
 * Get the latest feeding records for a baby.
 */
export async function getRecentFeeds(
  babyId: string,
  limit = 20,
): Promise<FeedRecord[]> {
  const { data, error } = await supabase
    .from("feed")
    .select("*")
    .eq("baby_id", babyId)
    .is("deleted_at", null)
    .order("starttime", {
      ascending: false,
    })
    .limit(limit);

  if (error) {
    throw error;
  }

  return (data ?? []) as FeedRecord[];
}

/**
 * Get feeding records from a given date.
 */
export async function getFeedsFromDate(
  babyId: string,
  fromDate: string,
): Promise<FeedRecord[]> {
  const { data, error } = await supabase
    .from("feed")
    .select("*")
    .eq("baby_id", babyId)
    .is("deleted_at", null)
    .gte("starttime", fromDate)
    .order("starttime", {
      ascending: true,
    });

  if (error) {
    throw error;
  }

  return (data ?? []) as FeedRecord[];
}