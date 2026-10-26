import { supabase } from "../lib/supabase";

export type FamilyMessageResult = {
  sent: number;
  reason?: "no_push_recipients";
};

export async function sendFamilyMessage(
  babyId: string,
  message: string,
): Promise<FamilyMessageResult> {
  const { data, error } = await supabase.functions.invoke<FamilyMessageResult>(
    "family-message",
    {
      body: {
        baby_id: babyId,
        message: message.trim(),
      },
    },
  );

  if (error) {
    throw new Error("Could not send family message.");
  }

  return data ?? { sent: 0, reason: "no_push_recipients" };
}
