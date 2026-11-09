import { Capacitor } from "@capacitor/core";
import { AppleSignIn, ErrorCode, SignInScope } from "@capawesome/capacitor-apple-sign-in";
import { supabase } from "../lib/supabase";

export function appleSignInSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios" &&
    Capacitor.isPluginAvailable("AppleSignIn");
}

export function isAppleSignInCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    error.code === ErrorCode.SignInCanceled;
}

export async function signInWithApple() {
  if (!appleSignInSupported()) throw new Error("Apple sign-in is unavailable.");
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  let credential;
  try {
    // Plugin 0.1.5 assigns options.nonce directly to ASAuthorizationAppleIDRequest.nonce.
    credential = await AppleSignIn.signIn({
      scopes: [SignInScope.Email, SignInScope.FullName], nonce: hashedNonce,
    });
  } catch (error) {
    if (isAppleSignInCancellation(error)) return null;
    // Do not retain native error objects that may contain authorization details.
    // eslint-disable-next-line preserve-caught-error
    throw new Error("Apple sign-in failed. Please try again.");
  }
  if (!credential.idToken) throw new Error("Apple did not return an identity token.");
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: "apple", token: credential.idToken, nonce,
  });
  if (error || !data.session || !data.user) {
    throw new Error("Could not establish your Apple sign-in session. Please try again.");
  }
  const name = [credential.givenName, credential.familyName].filter(Boolean).join(" ").trim();
  const metadata = data.user.user_metadata;
  if (name && ![metadata.display_name, metadata.full_name, metadata.name]
    .some((value) => typeof value === "string" && value.trim())) {
    // Apple returns the name only on first consent. Never replace an existing name.
    const { error: nameError } = await supabase.auth.updateUser({ data: { display_name: name, full_name: name } });
    if (nameError) throw new Error("Signed in, but your name could not be saved. You can retry sign-in.");
  }
  if (name) {
    // signInWithIdToken creates auth.users (and runs handle_new_user) BEFORE
    // updateUser can save Apple's first-consent name. Updating auth metadata
    // cannot retroactively change that INSERT trigger. Preserve even its email
    // fallback: fill only NULL/empty profiles using an atomic, RLS-protected update.
    const { error: profileError } = await supabase.from("profiles")
      .update({ display_name: name, updated_at: new Date().toISOString() })
      .eq("user_id", data.user.id)
      .or("display_name.is.null,display_name.eq.");
    if (profileError) throw new Error("Signed in, but your profile name could not be saved.");
  }
  return data;
}
