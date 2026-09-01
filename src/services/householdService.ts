import { supabase } from "../lib/supabase";
import { useAppStore, type Baby } from "../stores/appStore";
import { translate, type TranslationKey } from "../i18n";

function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(useAppStore.getState().language, key, params);
}

export interface Household {
  id: string;
  name: string;
  created_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export async function getMyHouseholds(): Promise<Household[]> {
  const { data, error } = await supabase
    .from("households")
    .select("*")
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    throw new Error(
      t("family.errorCouldNotLoadHouseholds", { error: error.message }),
    );
  }

  return (data ?? []) as Household[];
}

export async function getMyBabies(): Promise<Baby[]> {
  const { data, error } = await supabase
    .from("babies")
    .select("id, name, birth_date")
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    throw new Error(
      t("family.errorCouldNotLoadBabies", { error: error.message }),
    );
  }

  return (data ?? []) as Baby[];
}

export async function createHouseholdWithBaby(
  householdName: string,
  babyName: string,
  birthDate: string | null,
): Promise<{
  household_id: string;
  baby_id: string;
}> {
  const { data, error } = await supabase.rpc(
    "create_household_with_baby",
    {
      household_name: householdName.trim(),
      baby_name: babyName.trim(),
      baby_birth_date:
        birthDate && birthDate.length > 0
          ? birthDate
          : null,
    },
  );

  if (error) {
    throw new Error(
      t("family.errorCouldNotCreateFamily", { error: error.message }),
    );
  }

  if (!data) {
    throw new Error(
      t("family.errorServerNoFamily"),
    );
  }

  return data as {
    household_id: string;
    baby_id: string;
  };
}