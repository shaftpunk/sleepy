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

export async function updateDiaperChange(id: string, babyId: string, type: DiaperType, changedAt: string) {
  const { error } = await supabase.from("diaper_changes").update({ type, changed_at: changedAt })
    .eq("id", id).eq("baby_id", babyId).select("id").single();
  if (error) throw error;
}

export async function deleteDiaperChange(id: string, babyId: string) {
  const { error } = await supabase.from("diaper_changes").delete()
    .eq("id", id).eq("baby_id", babyId).select("id").single();
  if (error) throw error;
}
