"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null); // is there a recovery session?

  // The recovery link routes through /auth/confirm, which establishes a session
  // before landing here. Verify it exists so we can give a clear message if the
  // link was invalid/expired or opened on a different device.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) return setError(error.message);
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl">🚗</div>
          <h1 className="text-2xl font-bold">Set a new password</h1>
        </div>

        {ready === false ? (
          <div className="card space-y-3 text-center">
            <p className="text-sm text-slate-600">
              This reset link is invalid or has expired, or it was opened on a different device than
              where you requested it.
            </p>
            <Link href="/forgot-password" className="btn-primary w-full">Request a new link</Link>
          </div>
        ) : (
          <>
            {error && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            <form onSubmit={onSubmit} className="card space-y-4">
              <div>
                <label className="label" htmlFor="password">New password</label>
                <input
                  className="input" id="password" type="password" required minLength={6} autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div>
                <label className="label" htmlFor="confirm">Confirm new password</label>
                <input
                  className="input" id="confirm" type="password" required minLength={6} autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)}
                />
              </div>
              <button className="btn-primary w-full" type="submit" disabled={loading || ready === null}>
                {loading ? "Saving…" : "Update password"}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
