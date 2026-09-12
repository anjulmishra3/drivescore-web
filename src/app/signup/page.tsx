import Link from "next/link";
import { signUp } from "../login/actions";

export default function SignupPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl">
            🚗
          </div>
          <h1 className="text-2xl font-bold">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Start scoring your drives</p>
        </div>

        {searchParams.error && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {searchParams.error}
          </p>
        )}

        <form action={signUp} className="card space-y-4">
          <div>
            <label className="label" htmlFor="display_name">Name</label>
            <input className="input" id="display_name" name="display_name" type="text" autoComplete="name" />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" required minLength={6} autoComplete="new-password" />
            <p className="mt-1 text-xs text-slate-400">At least 6 characters.</p>
          </div>
          <button className="btn-primary w-full" type="submit">Create account</button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link className="font-semibold text-brand-600 hover:underline" href="/login">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
