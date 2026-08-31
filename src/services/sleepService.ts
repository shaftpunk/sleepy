import { supabase } from "../lib/supabase";
import type { BabyId } from "../stores/appStore";

export type SleepRecord = {
  id: string;
  bbyid: BabyId;

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
  bbyid: BabyId;

  starttime: string;
  endtime: string;

  rate?: string | null;
  note?: string | null;
};


function calculateMinutes(
  starttime: string,
  endtime: string
) {
  return Math.max(
    0,
    Math.round(
      (
        new Date(endtime).getTime() -
        new Date(starttime).getTime()
      ) / 60000
    )
  );
}


export async function startSleep(
  bbyid: BabyId
) {
  const current =
    await getActiveSleep(bbyid);

  if (current) {
    return current;
  }

  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .insert({
      bbyid,
      sleep_type: "sleep",

      starttime:
        new Date().toISOString(),

      endtime: null,

      durationminutes: null,
    })
    .select()
    .single();

  if (error) throw error;

  return data as SleepRecord;
}


export async function stopSleep(
  sleepId: string,
  starttime: string
) {
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
          endtime
        ),

      updated_at:
        new Date().toISOString(),
    })
    .eq("id", sleepId)
    .select()
    .single();

  if (error) throw error;

  return data as SleepRecord;
}


export async function createManualSleep(
  input: SleepInput
) {
  if (
    new Date(input.endtime).getTime() <=
    new Date(input.starttime).getTime()
  ) {
    throw new Error(
      "End time must be after start time."
    );
  }

  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .insert({
      bbyid:
        input.bbyid,

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
          input.endtime
        ),

      note:
        input.note ?? null,
    })
    .select()
    .single();

  if (error) throw error;

  return data as SleepRecord;
}


export async function updateSleep(
  id: string,
  starttime: string,
  endtime: string,
  rate?: string | null
) {
  if (
    new Date(endtime).getTime() <=
    new Date(starttime).getTime()
  ) {
    throw new Error(
      "End time must be after start time."
    );
  }

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
          endtime
        ),

      ...(rate !== undefined
        ? { rate }
        : {}),

      updated_at:
        new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;

  return data as SleepRecord;
}


export async function deleteSleep(
  id: string
) {
  const {
    error,
  } = await supabase
    .from("sleep")
    .delete()
    .eq("id", id);

  if (error) throw error;
}


export async function splitSleep(
  id: string,
  splitTime: string
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
      }
    );

  if (error) throw error;

  return (
    data ?? []
  ) as SleepRecord[];
}


export async function getActiveSleep(
  bbyid: BabyId
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq("bbyid", bbyid)
    .is("endtime", null)
    .order(
      "starttime",
      {
        ascending: false,
      }
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data as SleepRecord | null;
}


export async function getLastCompletedSleep(
  bbyid: BabyId
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq("bbyid", bbyid)
    .not(
      "endtime",
      "is",
      null
    )
    .order(
      "endtime",
      {
        ascending: false,
      }
    )
    .limit(1)
    .maybeSingle();

  if (error) throw error;

  return data as SleepRecord | null;
}


export async function getRecentSleeps(
  bbyid: BabyId,
  limit = 20
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq("bbyid", bbyid)
    .not(
      "endtime",
      "is",
      null
    )
    .order(
      "starttime",
      {
        ascending: false,
      }
    )
    .limit(limit);

  if (error) throw error;

  return (
    data ?? []
  ) as SleepRecord[];
}


export async function getSleepsFromDate(
  bbyid: BabyId,
  fromDate: string
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq("bbyid", bbyid)
    .gte(
      "starttime",
      fromDate
    )
    .order(
      "starttime",
      {
        ascending: true,
      }
    );

  if (error) throw error;

  return (
    data ?? []
  ) as SleepRecord[];
}


export async function getSleepsOverlappingPeriod(
  bbyid: BabyId,
  fromDate: string,
  toDate: string
) {
  const {
    data,
    error,
  } = await supabase
    .from("sleep")
    .select("*")
    .eq(
      "bbyid",
      bbyid
    )
    .lt(
      "starttime",
      toDate
    )
    .or(
      `endtime.is.null,endtime.gt.${fromDate}`
    )
    .order(
      "starttime",
      {
        ascending: true,
      }
    );

  if (error) throw error;

  return (
    data ?? []
  ) as SleepRecord[];
}