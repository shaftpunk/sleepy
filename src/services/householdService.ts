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

// Updates only the selected baby's own record (matched by its UUID
// `babies.id` — never by the legacy Hamar/Drammen bbyid). `birthDate` is a
// plain "YYYY-MM-DD" calendar-date string (or null to clear it) written
// as-is to the `birth_date date` column — never converted through a UTC
// timestamp. Relies on the existing RLS policy that already lets a
// household member read/write their own babies.
export async function updateBabyBirthDate(
  babyId: string,
  birthDate: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("babies")
    .update({
      birth_date: birthDate,
    })
    .eq("id", babyId);

  if (error) {
    throw new Error(
      t("family.errorCouldNotUpdateBirthDate", { error: error.message }),
    );
  }
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