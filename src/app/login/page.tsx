import Link from "next/link";
import { signIn } from "./actions";

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; message?: string; next?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-2xl">
            🚗
          </div>
          <h1 className="text-2xl font-bold">DriveScore</h1>
          <p className="mt-1 text-sm text-slate-500">Sign in to your account</p>
        </div>

        {searchParams.message && (
          <p className="mb-4 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
            {searchParams.message}
          </p>
        )}
        {searchParams.error && (
          <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            {searchParams.error}
          </p>
        )}

        <form action={signIn} className="card space-y-4">
          <input type="hidden" name="next" value={searchParams.next || "/dashboard"} />
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input className="input" id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input className="input" id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          <button className="btn-primary w-full" type="submit">Sign in</button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          No account?{" "}
          <Link className="font-semibold text-brand-600 hover:underline" href="/signup">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
