#!/usr/bin/env python3
"""Bound generated snapshots; never operate on live database or storage volumes."""
import argparse
import json
import pathlib
import re
import shutil

STAMP = re.compile(r"\d{8}T\d{6}Z")


def checked_directory(root, name):
    candidate = root / name
    if not STAMP.fullmatch(name) or candidate.is_symlink() or candidate.resolve().parent != root:
        raise ValueError("Unsafe backup directory")
    return candidate


def plan(root, keep_full=7, keep_database=90, budget_bytes=18 * 1024**3):
    root = root.resolve(strict=True)
    if keep_full < 2 or keep_database < keep_full or budget_bytes <= 0:
        raise ValueError("Invalid backup retention limits")
    completed = []
    for candidate in sorted(root.iterdir()):
        if candidate.is_symlink() or not candidate.is_dir() or not STAMP.fullmatch(candidate.name):
            continue
        if all((candidate / name).is_file() and not (candidate / name).is_symlink()
               for name in ("database.dump", "checksums.sha256")):
            completed.append(candidate)
    full = [p for p in completed if (p / "storage.tar.gz").is_file() and not (p / "storage.tar.gz").is_symlink()]
    # Preserve the original baseline independently of the rolling snapshots.
    baseline = full[0] if full else None
    retained = {baseline} if baseline else set()
    recent = []
    total = 0
    for directory in reversed(full):
        if directory == baseline:
            continue
        size = (directory / "storage.tar.gz").stat().st_size
        if len(recent) < 2 or (len(recent) < keep_full and total + size <= budget_bytes):
            retained.add(directory)
            recent.append(directory)
            total += size
    keep_db = set(completed[-keep_database:]) | retained
    return {
        "root": str(root),
        "retainedFull": sorted(p.name for p in retained),
        "retainedRecentBytes": total,
        "removeStorage": [{"backup": p.name, "bytes": (p / "storage.tar.gz").stat().st_size}
                          for p in full if p not in retained and p in keep_db],
        "removeDirectories": [p.name for p in completed if p not in keep_db],
    }


def apply(result):
    root = pathlib.Path(result["root"]).resolve(strict=True)
    for record in result["removeStorage"]:
        directory = checked_directory(root, record["backup"])
        archive = directory / "storage.tar.gz"
        if archive.is_symlink() or archive.stat().st_size != record["bytes"]:
            raise ValueError("Backup changed after retention planning")
        archive.unlink()
        (directory / "storage-pruned.json").write_text(json.dumps({
            "reason": "rolling storage retention", "databaseBackupRetained": True,
        }), encoding="utf-8")
    for name in result["removeDirectories"]:
        directory = checked_directory(root, name)
        if not all((directory / part).is_file() and not (directory / part).is_symlink()
                   for part in ("database.dump", "checksums.sha256")):
            raise ValueError("Incomplete backup cannot be removed")
        shutil.rmtree(directory)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=pathlib.Path)
    parser.add_argument("--keep-full", type=int, default=7)
    parser.add_argument("--keep-database", type=int, default=90)
    parser.add_argument("--budget-bytes", type=int, default=18 * 1024**3)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    result = plan(args.root, args.keep_full, args.keep_database, args.budget_bytes)
    if args.apply:
        apply(result)
    print(json.dumps({**result, "applied": args.apply}))
