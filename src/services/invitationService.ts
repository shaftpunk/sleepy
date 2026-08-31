import { supabase } from "../lib/supabase";

export type HouseholdRole =
  | "parent"
  | "caregiver"
  | "viewer";

export type HouseholdInvitationResult = {
  invitation_id: string;
  household_id: string;
  role: HouseholdRole;
  token: string;
  expires_at: string;
};

export type AcceptedInvitationResult = {
  household_id: string;
  household_name: string;
  role: HouseholdRole;
};

export async function createHouseholdInvitation(
  householdId: string,
  role: HouseholdRole = "parent",
  expiresHours = 24,
): Promise<HouseholdInvitationResult> {
  const { data, error } = await supabase.rpc(
    "create_household_invitation",
    {
      p_household_id: householdId,
      p_role: role,
      p_expires_hours: expiresHours,
    },
  );

  if (error) {
    throw new Error(
      `Could not create invitation: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      "The server did not return an invitation.",
    );
  }

  return data as HouseholdInvitationResult;
}

export async function acceptHouseholdInvitation(
  token: string,
): Promise<AcceptedInvitationResult> {
  const cleanToken = token.trim();

  if (!cleanToken) {
    throw new Error(
      "Please enter an invitation code.",
    );
  }

  const { data, error } = await supabase.rpc(
    "accept_household_invitation",
    {
      p_token: cleanToken,
    },
  );

  if (error) {
    throw new Error(
      `Could not accept invitation: ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      "The server did not return the household.",
    );
  }

  return data as AcceptedInvitationResult;
}