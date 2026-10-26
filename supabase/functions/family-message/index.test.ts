import { assertEquals } from "jsr:@std/assert@1";

import { validateFamilyMessageRequest } from "./validation.ts";

const BABY_ID = "123e4567-e89b-42d3-a456-426614174000";

Deno.test("validateFamilyMessageRequest accepts a short UUID-scoped message", () => {
  assertEquals(
    validateFamilyMessageRequest({
      baby_id: BABY_ID,
      message: " On my way ❤️ ",
    }),
    { babyId: BABY_ID, message: "On my way ❤️" },
  );
});

Deno.test("validateFamilyMessageRequest rejects missing, non-UUID, and blank input", () => {
  assertEquals(validateFamilyMessageRequest({ message: "Hello" }), null);
  assertEquals(
    validateFamilyMessageRequest({ baby_id: "not-a-uuid", message: "Hello" }),
    null,
  );
  assertEquals(
    validateFamilyMessageRequest({ baby_id: BABY_ID, message: "   " }),
    null,
  );
});

Deno.test("validateFamilyMessageRequest rejects messages longer than 200 characters", () => {
  assertEquals(
    validateFamilyMessageRequest({
      baby_id: BABY_ID,
      message: "x".repeat(201),
    }),
    null,
  );
});
