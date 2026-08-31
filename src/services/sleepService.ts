import { supabase } from "../lib/supabase";

export type SleepRecord = {
  id: string;

  // Sleepy 3.0
  baby_id: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  deleted_at: string | null;
  deleted_by_user_id: string | null;

  sleep_type: string;

  rate: string | null;

  starttime: string;
  endtime: string | null;

  durationminutes: number | null;

  note?: string | null;

  created_at?: string;
  updated_at?: string;
};

export type SleepInput = {
  baby_id: string;

  starttime: string;
  endtime: string;

  rate?: string | null;
  note?: string | null;
};

function calculateMinutes(
  starttime: string,
  endtime: string,
) {
  return Math.max(
    0,
    Math.round(
      (
        new Date(endtime).getTime() -
        new Date(starttime).getTime()
      ) / 60000,
    ),
  );
}

async function getCurrentUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw error;
  }

  if (!user) {
    throw new Error("You must be logged in.");
  }

  return user.id;
}

export async function startSleep(
  babyId: string,
) {
  const current =
    await getActiveSleep(babyId);

  if (current) {
    return current;
  }

  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .insert({
      baby_id: babyId,

      sleep_type: "sleep",

      starttime:
        new Date().toISOString(),

      endtime: null,

      durationminutes: null,

      created_by_user_id:
        userId,

      updated_by_user_id:
        userId,

      deleted_at: null,
      deleted_by_user_id: null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as SleepRecord;
}

export async function stopSleep(
  sleepId: string,
  starttime: string,
) {
  const userId =
    await getCurrentUserId();

  const endtime =
    new Date().toISOString();

  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .update({
      endtime,

      durationminutes:
        calculateMinutes(
          starttime,
          endtime,
        ),

      updated_by_user_id:
        userId,

      updated_at:
        new Date().toISOString(),
    })
    .eq("id", sleepId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as SleepRecord;
}

export async function createManualSleep(
  input: SleepInput,
) {
  if (
    new Date(input.endtime).getTime() <=
    new Date(input.starttime).getTime()
  ) {
    throw new Error(
      "End time must be after start time.",
    );
  }

  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .insert({
      baby_id:
        input.baby_id,

      sleep_type:
        "sleep",

      rate:
        input.rate ?? null,

      starttime:
        input.starttime,

      endtime:
        input.endtime,

      durationminutes:
        calculateMinutes(
          input.starttime,
          input.endtime,
        ),

      note:
        input.note ?? null,

      created_by_user_id:
        userId,

      updated_by_user_id:
        userId,

      deleted_at: null,
      deleted_by_user_id: null,
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as SleepRecord;
}

export async function updateSleep(
  id: string,
  starttime: string,
  endtime: string,
  rate?: string | null,
) {
  if (
    new Date(endtime).getTime() <=
    new Date(starttime).getTime()
  ) {
    throw new Error(
      "End time must be after start time.",
    );
  }

  const userId =
    await getCurrentUserId();

  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .update({
      starttime,
      endtime,

      durationminutes:
        calculateMinutes(
          starttime,
          endtime,
        ),

      ...(rate !== undefined
        ? { rate }
        : {}),

      updated_by_user_id:
        userId,

      updated_at:
        new Date().toISOString(),
    })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    throw error;
  }

  return data as SleepRecord;
}

/**
 * Soft delete.
 *
 * The sleep record remains in the database
 * for audit/history purposes.
 */
export async function deleteSleep(
  id: string,
) {
  const userId =
    await getCurrentUserId();

  const now =
    new Date().toISOString();

  const {
    error,
  } = await supabase
    .from("sleep")
    .update({
      deleted_at: now,
      deleted_by_user_id:
        userId,
      updated_by_user_id:
        userId,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    throw error;
  }
}

/**
 * Existing database RPC.
 *
 * We keep this call for now.
 * The underlying function will be reviewed
 * separately for Sleepy 3.0.
 */
export async function splitSleep(
  id: string,
  splitTime: string,
) {
  const {
    data,
    error,
  } = await supabase
    .rpc(
      "split_sleep_session",
      {
        p_sleep_id: id,
        p_split_time: splitTime,
      },
    );

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ) as SleepRecord[];
}

export async function getActiveSleep(
  babyId: string,
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq(
      "baby_id",
      babyId,
    )
    .is(
      "deleted_at",
      null,
    )
    .is(
      "endtime",
      null,
    )
    .order(
      "starttime",
      {
        ascending: false,
      },
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as SleepRecord | null;
}

export async function getLastCompletedSleep(
  babyId: string,
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq(
      "baby_id",
      babyId,
    )
    .is(
      "deleted_at",
      null,
    )
    .not(
      "endtime",
      "is",
      null,
    )
    .order(
      "endtime",
      {
        ascending: false,
      },
    )
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as SleepRecord | null;
}

export async function getRecentSleeps(
  babyId: string,
  limit = 20,
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq(
      "baby_id",
      babyId,
    )
    .is(
      "deleted_at",
      null,
    )
    .not(
      "endtime",
      "is",
      null,
    )
    .order(
      "starttime",
      {
        ascending: false,
      },
    )
    .limit(limit);

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ) as SleepRecord[];
}

export async function getSleepsFromDate(
  babyId: string,
  fromDate: string,
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq(
      "baby_id",
      babyId,
    )
    .is(
      "deleted_at",
      null,
    )
    .gte(
      "starttime",
      fromDate,
    )
    .order(
      "starttime",
      {
        ascending: true,
      },
    );

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ) as SleepRecord[];
}

export async function getSleepsOverlappingPeriod(
  babyId: string,
  fromDate: string,
  toDate: string,
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq(
      "baby_id",
      babyId,
    )
    .is(
      "deleted_at",
      null,
    )
    .lt(
      "starttime",
      toDate,
    )
    .or(
      `endtime.is.null,endtime.gt.${fromDate}`,
    )
    .order(
      "starttime",
      {
        ascending: true,
      },
    );

  if (error) {
    throw error;
  }

  return (
    data ?? []
  ) as SleepRecord[];
}