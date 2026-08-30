import { supabase } from "../lib/supabase";
import type { BabyId } from "../stores/appStore";

export type FeedType = "bottle" | "breast" | "food";
export type FeedSide = "left" | "right" | "both" | null;

export type FeedRecord = {
  id: string;
  bbyid: BabyId;
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
  bbyid: BabyId;
  feedtype: FeedType;
  side?: FeedSide;
  amountml?: number | null;
  starttime?: string;
  endtime?: string | null;
  durationminutes?: number | null;
  note?: string | null;
};

export async function createFeed(input: FeedInput) {
  const { data, error } = await supabase
    .from("feed")
    .insert({
      bbyid: input.bbyid,
      feedtype: input.feedtype,
      side: input.side ?? null,
      amountml: input.amountml ?? null,
      starttime: input.starttime ?? new Date().toISOString(),
      endtime: input.endtime ?? null,
      durationminutes: input.durationminutes ?? null,
      note: input.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  return data as FeedRecord;
}

export async function updateFeed(
  id: string,
  input: Partial<FeedInput>
) {
  const { data, error } = await supabase
    .from("feed")
    .update({
      feedtype: input.feedtype,
      side: input.side,
      amountml: input.amountml,
      starttime: input.starttime,
      endtime: input.endtime,
      durationminutes: input.durationminutes,
      note: input.note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data as FeedRecord;
}

export async function deleteFeed(id: string) {
  const { error } = await supabase
    .from("feed")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

export async function getLastFeed(bbyid: BabyId) {
  const { data, error } = await supabase
    .from("feed")
    .select("*")
    .eq("bbyid", bbyid)
    .order("starttime", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data as FeedRecord | null;
}

export async function getRecentFeeds(
  bbyid: BabyId,
  limit = 20
) {
  const { data, error } = await supabase
    .from("feed")
    .select("*")
    .eq("bbyid", bbyid)
    .order("starttime", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []) as FeedRecord[];
}

export async function getFeedsFromDate(
  bbyid: BabyId,
  fromDate: string
) {
  const { data, error } = await supabase
    .from("feed")
    .select("*")
    .eq("bbyid", bbyid)
    .gte("starttime", fromDate)
    .order("starttime", { ascending: true });

  if (error) throw error;

  return (data ?? []) as FeedRecord[];
}