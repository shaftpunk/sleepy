import { supabase } from "../lib/supabase";

export const diaperTypes = ["wet", "dirty", "both"] as const;
export type DiaperType = (typeof diaperTypes)[number];

export type DiaperChange = {
  id: string;
  baby_id: string;
  type: DiaperType;
  changed_at: string;
  created_at: string;
  created_by: string | null;
};

export async function createDiaperChange(babyId: string, type: DiaperType, changedAt?: string) {
  const { data, error } = await supabase.from("diaper_changes")
    .insert({ baby_id: babyId, type, ...(changedAt ? { changed_at: changedAt } : {}) })
    .select().single();
  if (error) throw error;
  return data as DiaperChange;
}

export async function getRecentDiaperChanges(babyId: string, limit = 20) {
  const { data, error } = await supabase.from("diaper_changes").select("*")
    .eq("baby_id", babyId).order("changed_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data as DiaperChange[];
}
