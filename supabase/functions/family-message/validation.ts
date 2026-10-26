export const MAX_MESSAGE_LENGTH = 200;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface FamilyMessageRequest {
  baby_id?: unknown;
  message?: unknown;
}

export interface ValidFamilyMessageRequest {
  babyId: string;
  message: string;
}

export function validateFamilyMessageRequest(
  payload: FamilyMessageRequest,
): ValidFamilyMessageRequest | null {
  if (
    typeof payload.baby_id !== "string" ||
    !UUID_PATTERN.test(payload.baby_id) ||
    typeof payload.message !== "string"
  ) {
    return null;
  }

  const message = payload.message.trim();

  if (!message || message.length > MAX_MESSAGE_LENGTH) {
    return null;
  }

  return { babyId: payload.baby_id, message };
}
