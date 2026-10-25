"""Run Supabase migration files against your database, from PyCharm or any terminal.

Usage:
    python scripts/run_migration.py                      # runs the newest file in supabase/migrations/
    python scripts/run_migration.py supabase/migrations/20261030000000_attachments.sql

Needs:  pip install "psycopg[binary]"

The connection string comes from the SUPABASE_DB_URL environment variable, or the script asks
for it. Get it in the Supabase dashboard: Connect (top of the project page) -> "Session pooler"
-> URI, and put your database password in place of [YOUR-PASSWORD].
Each file runs in one transaction: if anything fails, nothing in that file is applied.
"""

from __future__ import annotations

import getpass
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "supabase" / "migrations"


def connection_url() -> str:
    """The database URL from SUPABASE_DB_URL, or typed in (hidden, since it holds the password)."""
    url = os.environ.get("SUPABASE_DB_URL", "").strip()
    if not url:
        print("Paste the Session pooler connection string (postgresql://...), with your password filled in.")
        print("(Nothing shows while you paste; press Enter when done.)")
        url = getpass.getpass("SUPABASE_DB_URL: ").strip()
    if not url.startswith(("postgresql://", "postgres://")):
        sys.exit("That doesn't look like a connection string. It should start with postgresql://")
    if "[YOUR-PASSWORD]" in url:
        sys.exit("Replace [YOUR-PASSWORD] in the connection string with your database password.")
    return url


def files_to_run(args: list[str]) -> list[Path]:
    """The files named on the command line, or the newest migration if none were given."""
    if args:
        paths = [Path(a) if Path(a).is_absolute() else (Path.cwd() / a) for a in args]
        paths = [p if p.exists() else ROOT / a for p, a in zip(paths, args)]
    else:
        newest = sorted(MIGRATIONS.glob("*.sql"))
        if not newest:
            sys.exit(f"No .sql files in {MIGRATIONS}")
        paths = [newest[-1]]
    missing = [str(p) for p in paths if not p.is_file()]
    if missing:
        sys.exit("Not found: " + ", ".join(missing))
    return paths


def main() -> None:
    try:
        import psycopg
    except ImportError:
        sys.exit('psycopg is not installed. In PyCharm\'s terminal run:  pip install "psycopg[binary]"')

    paths = files_to_run(sys.argv[1:])
    url = connection_url()
    try:
        with psycopg.connect(url, connect_timeout=15) as conn:
            for path in paths:
                sql = path.read_text(encoding="utf-8")
                print(f"Running {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} ...")
                with conn.transaction():
                    conn.execute(sql)
                print("  done")
    except psycopg.OperationalError as e:
        sys.exit(
            f"Couldn't connect: {e}\n"
            "Check the password, and use the Session pooler string (the Direct one needs IPv6)."
        )
    except psycopg.Error as e:
        sys.exit(f"The database refused the migration (nothing in that file was applied):\n{e}")
    print("All migrations ran. Reload the app.")


if __name__ == "__main__":
    main()
