import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://zebrmlignzctngbxijql.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USER_ID = "f5356205-3166-4292-bc50-c54fd7b63704";
const NEW_PASSWORD = "Amalie2026!";

if (!SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_SERVICE_ROLE_KEY mangler");
}

const supabase = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

const { data, error } =
  await supabase.auth.admin.updateUserById(
    USER_ID,
    {
      password: NEW_PASSWORD,
    },
  );

if (error) {
  console.error(error);
  process.exit(1);
}

console.log(
  "Password updated for:",
  data.user.email,
);