"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    // The recovery email links to /auth/confirm, which exchanges the code for a
    // session and forwards to /reset-password where the new password is set.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl">🚗</div>
          <h1 className="text-2xl font-bold">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-500">We&apos;ll email you a reset link</p>
        </div>

        {sent ? (
          <div className="card space-y-3 text-center">
            <div className="text-3xl">📧</div>
            <p className="text-sm text-slate-600">
              If an account exists for <strong>{email}</strong>, a password-reset link is on its way.
              Open it on this device and you&apos;ll be able to set a new password.
            </p>
            <p className="text-xs text-slate-400">
              Didn&apos;t get it? Check spam — free-tier email can be slow — or try again.
            </p>
            <Link href="/login" className="btn-ghost w-full">Back to sign in</Link>
          </div>
        ) : (
          <>
            {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <form onSubmit={onSubmit} className="card space-y-4">
              <div>
                <label className="label" htmlFor="email">Email</label>
                <input
                  className="input" id="email" type="email" required autoComplete="email"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button className="btn-primary w-full" type="submit" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-slate-500">
              Remembered it?{" "}
              <Link className="font-semibold text-brand-600 hover:underline" href="/login">Sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
