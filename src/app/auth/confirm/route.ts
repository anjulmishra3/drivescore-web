import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Email-confirmation callback. Supports both Supabase flows so it works on the
// free tier with the DEFAULT email template (no template editing required):
//
//   1. Default template ({{ .ConfirmationURL }}): Supabase verifies the token,
//      then redirects here with a `?code=...` we exchange for a session.
//   2. Custom template ({{ .TokenHash }}): we verify the token_hash directly.
//
// signUp() sets emailRedirectTo to this route, so the default template's link
// lands here after Supabase's own verify step.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/onboarding";

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  const supabase = createClient();

  // Flow 1: PKCE code exchange (default template)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirectTo.pathname = next;
      return NextResponse.redirect(redirectTo);
    }
  }

  // Flow 2: token_hash verification (custom template)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      redirectTo.pathname = next;
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/login";
  redirectTo.search = "?error=" + encodeURIComponent("Email link is invalid or has expired.");
  return NextResponse.redirect(redirectTo);
}
