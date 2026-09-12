import Link from "next/link";
import { signOut } from "@/app/login/actions";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/record", label: "Record trip" },
  { href: "/calibrate", label: "Calibrate" },
  { href: "/settings", label: "Settings" },
];

export default function AppNav({ name }: { name?: string | null }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <Link href="/dashboard" className="flex items-center gap-2 font-bold">
          <span className="text-xl">🚗</span> DriveScore
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <form action={signOut}>
          <button className="text-sm font-medium text-slate-500 hover:text-slate-900" type="submit">
            Sign out
          </button>
        </form>
      </div>
      {/* mobile nav */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 px-2 py-1.5 sm:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
