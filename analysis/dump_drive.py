#!/usr/bin/env python3
"""
Dump one drive's full sensor stream to a CSV for offline analysis.

Reads the DB connection string from env DB_URL or ../map/.db_url (same Session-
pooler/Direct URI used by the map pipeline). The app itself never uses this
connection — only the anon key.

    python3 analysis/dump_drive.py                 # default: yesterday's 12:37 drive
    python3 analysis/dump_drive.py <trip_uuid>     # any trip

Writes analysis/data/trip_<id>.csv. If you'd rather not set up DB creds, run the
SELECT below in the Supabase SQL editor and use its "Download CSV" button.
"""
import os, sys
from sqlalchemy import create_engine, text
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__)) + "/"
DEFAULT_TRIP = "4941031e-df94-4caf-ab4c-f821e1b8b9fd"  # 2026-11-01 09:41 UTC, first drive (has labels)


def db_url():
    url = os.environ.get("DB_URL")
    if not url:
        with open(HERE + "../map/.db_url") as f:
            url = f.read().strip()
    if url.startswith("postgresql://"):
        url = "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


def main():
    trip = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TRIP
    eng = create_engine(db_url())
    q = text(
        "select seq, t_ms, speed_kmh, accel_x, accel_y, accel_z, "
        "gyro_alpha, gyro_beta, gyro_gamma, lat, lng "
        "from trip_samples where trip_id = :t order by seq"
    )
    df = pd.read_sql(q, eng, params={"t": trip})
    os.makedirs(HERE + "data", exist_ok=True)
    out = HERE + f"data/trip_{trip}.csv"
    df.to_csv(out, index=False)
    print(f"Wrote {len(df):,} sample rows to {out}")

    # labels too (for overlaying confirmed turns / lane changes in the notebook)
    lab = pd.read_sql(
        text("select t_ms, type, source, direction, confirmed, speed_kmh, lat, lng "
             "from trip_labels where trip_id = :t order by t_ms"),
        eng, params={"t": trip},
    )
    lout = HERE + f"data/trip_{trip}_labels.csv"
    lab.to_csv(lout, index=False)
    print(f"Wrote {len(lab):,} label rows to {lout}")


if __name__ == "__main__":
    main()
