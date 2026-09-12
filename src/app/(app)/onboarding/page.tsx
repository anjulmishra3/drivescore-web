import Link from "next/link";

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Getting started</h1>
        <p className="mt-1 text-sm text-slate-500">
          DriveScore uses your phone&apos;s own sensors — no extra hardware needed. Here&apos;s how
          to get the most accurate scores.
        </p>
      </div>

      <section className="card space-y-4">
        <Step
          n={1}
          title="Mount your phone"
          body="Use a dashboard or vent mount so the phone stays still and level. A phone sliding around in a cupholder produces noisy accelerometer data and unreliable scores."
        />
        <Step
          n={2}
          title="Allow location & motion access"
          body="When you start a drive we ask for location (GPS) and motion (accelerometer + gyroscope). On iPhone, motion access only unlocks when you tap the Start button — that's expected."
        />
        <Step
          n={3}
          title="Run a calibration drive"
          body="A short ~2-minute drive that checks all three sensors report correctly and are oriented right, before you count on your scores."
        />
        <Step
          n={4}
          title="Record trips"
          body="Use Quick trip for short errands. Keep the screen on and this tab open — phone browsers suspend background tabs, so longer commutes with the screen off will come in a native app later."
        />
      </section>

      <div className="card bg-brand-50">
        <p className="text-sm text-brand-900">
          <strong>Heads up:</strong> for continuous, screen-off recording on long commutes, browsers
          throttle background tabs — that&apos;s the job of the planned native app. The web app is
          for calibration, short trips, and viewing your scores.
        </p>
      </div>

      <div className="flex gap-2">
        <Link href="/calibrate" className="btn-primary flex-1">Start calibration drive</Link>
        <Link href="/dashboard" className="btn-ghost flex-1">Skip to dashboard</Link>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">
        {n}
      </div>
      <div>
        <div className="text-sm font-semibold text-slate-800">{title}</div>
        <div className="mt-0.5 text-sm text-slate-500">{body}</div>
      </div>
    </div>
  );
}
