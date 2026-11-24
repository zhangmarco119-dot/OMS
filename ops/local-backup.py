#!/usr/bin/env python3
"""Pull complete database snapshots and reusable image blobs to this computer."""
import argparse
import contextlib
import concurrent.futures
import datetime
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid

HASH = re.compile(r"[a-f0-9]{64}")
STAMP = re.compile(r"\d{8}T\d{6}Z-[a-f0-9]{8}")


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def atomic_json(path, value):
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def digest_file(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def blob_path(root, digest):
    if not HASH.fullmatch(digest):
        raise ValueError("Invalid image digest")
    return root / "blobs" / digest[:2] / digest


def validate_manifest(manifest):
    if manifest.get("format") != 1 or not isinstance(manifest.get("files"), list):
        raise ValueError("Invalid storage inventory")
    seen = set()
    for item in manifest["files"]:
        name = item.get("path", "")
        if not isinstance(name, str) or not name or name.startswith("/") or "\0" in name:
            raise ValueError("Unsafe image path")
        if any(part in ("", ".", "..") for part in name.split("/")) or name in seen:
            raise ValueError("Duplicate or unsafe image path")
        seen.add(name)
        if not HASH.fullmatch(item.get("sha256", "")) or not isinstance(item.get("size"), int) or item["size"] < 0:
            raise ValueError("Invalid image size or hash")
    if manifest.get("fileCount") != len(seen) or manifest.get("bytes") != sum(item["size"] for item in manifest["files"]):
        raise ValueError("Inventory count mismatch")


@contextlib.contextmanager
def remote(config, environment, action, **extra):
    args = [config["sshExecutable"], "-T", "-i", config["identityFile"], "-o", "BatchMode=yes",
            "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes", "-o",
            "UserKnownHostsFile=" + config["knownHostsFile"], "-o", "ConnectTimeout=15",
            "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "IPQoS=none", config["host"], "storehub-backup"]
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=errors)
        timer = threading.Timer(1800, process.kill)
        timer.daemon = True
        timer.start()
        try:
            process.stdin.write(json.dumps({"environment": environment, "action": action, **extra}).encode() + b"\n")
            process.stdin.close()
            yield process.stdout
            if process.wait(timeout=60) != 0:
                errors.seek(0)
                raise RuntimeError("SSH backup source failed: " + errors.read(4096).decode("utf-8", "replace"))
        finally:
            timer.cancel()
            if process.poll() is None:
                process.kill()
            process.wait()
            process.stdout.close()


def export_file(config, environment, action, destination):
    partial = destination.with_name(destination.name + ".part")
    try:
        with remote(config, environment, action) as source, partial.open("wb") as output:
            shutil.copyfileobj(source, output, 1024 * 1024)
            output.flush()
            os.fsync(output.fileno())
        if not partial.stat().st_size:
            raise ValueError("Empty backup export")
        if action == "database":
            with partial.open("rb") as source:
                if source.read(5) != b"PGDMP":
                    raise ValueError("Invalid PostgreSQL backup header")
        os.replace(partial, destination)
    finally:
        partial.unlink(missing_ok=True)


def read_frame(source):
    line = source.readline(65537)
    if not line or len(line) > 65536:
        raise ValueError("Incomplete image transfer header")
    return json.loads(line)


def receive_assets(source, wanted, root):
    for item in wanted:
        header = read_frame(source)
        if header != {"path": item["path"], "size": item["size"]}:
            raise ValueError("Image transfer does not match inventory")
        target = blob_path(root, item["sha256"])
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_name(target.name + ".part")
        digest = hashlib.sha256()
        remaining = item["size"]
        try:
            with partial.open("wb") as output:
                while remaining:
                    block = source.read(min(remaining, 1024 * 1024))
                    if not block:
                        raise ValueError("Image transfer interrupted")
                    output.write(block)
                    digest.update(block)
                    remaining -= len(block)
                output.flush()
                os.fsync(output.fileno())
            footer = read_frame(source)
            if footer.get("sha256") != item["sha256"] or digest.hexdigest() != item["sha256"]:
                raise ValueError("Image content checksum mismatch")
            os.replace(partial, target)
        finally:
            partial.unlink(missing_ok=True)
    if read_frame(source) != {"done": True, "count": len(wanted)}:
        raise ValueError("Incomplete image batch")


def seed_blobs(root, files, seed_directories):
    marker = root / "seed-status.json"
    if marker.exists() and json.loads(marker.read_text(encoding="utf-8")).get("directories") == seed_directories:
        return 0
    wanted = {item["sha256"]: item for item in files if not blob_path(root, item["sha256"]).exists()}
    sizes = {item["size"] for item in wanted.values()}
    seeded = 0
    for directory in seed_directories:
        for base, children, names in os.walk(directory, followlinks=False):
            children[:] = [name for name in children if not (pathlib.Path(base) / name).is_symlink()]
            for name in names:
                source = pathlib.Path(base) / name
                if source.is_symlink() or source.stat().st_size not in sizes:
                    continue
                digest = digest_file(source)
                if digest not in wanted:
                    continue
                target = blob_path(root, digest)
                target.parent.mkdir(parents=True, exist_ok=True)
                partial = target.with_name(target.name + ".part")
                shutil.copyfile(source, partial)
                if digest_file(partial) == digest:
                    os.replace(partial, target)
                    seeded += 1
                    wanted.pop(digest)
                else:
                    partial.unlink(missing_ok=True)
    atomic_json(marker, {"directories": seed_directories, "completedAt": now()})
    return seeded


def verify_snapshot(root, snapshot):
    metadata = json.loads((snapshot / "backup.json").read_text(encoding="utf-8"))
    if metadata.get("format") != 1 or set(metadata.get("artifacts", {})) != {
            "database.dump", "globals.sql", "config.tar.gz", "database-keys.tar.gz", "storage-manifest.json"}:
        raise ValueError("Incomplete snapshot metadata")
    for name, expected in metadata["artifacts"].items():
        if name not in ("database.dump", "globals.sql", "config.tar.gz", "database-keys.tar.gz", "storage-manifest.json"):
            raise ValueError("Invalid snapshot artifact")
        if digest_file(snapshot / name) != expected:
            raise ValueError("Snapshot artifact checksum mismatch")
    manifest = json.loads((snapshot / "storage-manifest.json").read_text(encoding="utf-8"))
    validate_manifest(manifest)
    checked = set()
    for item in manifest["files"]:
        if item["sha256"] in checked:
            continue
        path = blob_path(root, item["sha256"])
        if path.stat().st_size != item["size"] or digest_file(path) != item["sha256"]:
            raise ValueError("A referenced image is missing or corrupted")
        checked.add(item["sha256"])
    return metadata


def retention(root, count):
    snapshots = root / "snapshots"
    complete = sorted(p for p in snapshots.iterdir() if STAMP.fullmatch(p.name) and p.is_dir()
                      and not p.is_symlink() and (p / "backup.json").is_file())
    keep = set(complete[-count:] + complete[:1])
    referenced = set()
    # Parse all retained manifests before deleting anything; keep extra data on error.
    for snapshot in keep:
        manifest = json.loads((snapshot / "storage-manifest.json").read_text(encoding="utf-8"))
        validate_manifest(manifest)
        referenced.update(item["sha256"] for item in manifest["files"])
    for snapshot in complete:
        if snapshot not in keep:
            if snapshot.resolve().parent != snapshots.resolve():
                raise ValueError("Unsafe snapshot retention path")
            shutil.rmtree(snapshot)
    blobs = root / "blobs"
    for prefix in blobs.iterdir():
        if prefix.is_symlink() or not prefix.is_dir() or not re.fullmatch(r"[a-f0-9]{2}", prefix.name):
            continue
        for blob in prefix.iterdir():
            if not blob.is_symlink() and HASH.fullmatch(blob.name) and blob.name not in referenced:
                blob.unlink()
            elif not blob.is_symlink() and re.fullmatch(r"[a-f0-9]{64}\.part", blob.name):
                blob.unlink()
    pending = root / "pending"
    if pending.exists():
        for directory in pending.iterdir():
            if STAMP.fullmatch(directory.name) and directory.is_dir() and not directory.is_symlink():
                if directory.resolve().parent != pending.resolve():
                    raise ValueError("Unsafe incomplete snapshot path")
                shutil.rmtree(directory)


def backup(config, environment, boot_id):
    root = pathlib.Path(config["root"]) / environment
    for name in ("snapshots", "pending", "blobs"):
        (root / name).mkdir(parents=True, exist_ok=True)
    name = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    pending = root / "pending" / name
    pending.mkdir()
    started = now()
    export_file(config, environment, "database", pending / "database.dump")
    export_file(config, environment, "globals", pending / "globals.sql")
    export_file(config, environment, "config", pending / "config.tar.gz")
    export_file(config, environment, "database-keys", pending / "database-keys.tar.gz")
    with remote(config, environment, "inventory") as source:
        manifest = json.load(source)
    validate_manifest(manifest)
    atomic_json(pending / "storage-manifest.json", manifest)
    unique = {item["sha256"]: item for item in manifest["files"]}
    seed_budget = sum(item["size"] for digest, item in unique.items() if not blob_path(root, digest).exists())
    if shutil.disk_usage(root).free < seed_budget + config.get("minimumFreeBytes", 10 * 1024**3):
        raise ValueError("Insufficient space to prepare local images")
    seeded = seed_blobs(root, manifest["files"], config.get("seedDirectories", {}).get(environment, []))
    missing, checked = [], set()
    for item in manifest["files"]:
        digest = item["sha256"]
        if digest in checked:
            continue
        checked.add(digest)
        existing = blob_path(root, digest)
        if not existing.exists() or existing.stat().st_size != item["size"] or digest_file(existing) != digest:
            missing.append(item)
    transferred = sum(item["size"] for item in missing)
    if shutil.disk_usage(root).free < transferred + config.get("minimumFreeBytes", 10 * 1024**3):
        raise ValueError("Insufficient local disk space; previous backups are preserved")
    print(json.dumps({"environment": environment, "phase": "images", "files": manifest["fileCount"],
                      "seeded": seeded, "downloadFiles": len(missing), "downloadBytes": transferred}), flush=True)
    groups = [missing[offset:offset + 128] for offset in range(0, len(missing), 128)]

    def transfer(group):
        with remote(config, environment, "assets", files=[{"path": p["path"], "size": p["size"]} for p in group]) as source:
            receive_assets(source, group, root)
        return len(group)

    completed = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for future in concurrent.futures.as_completed([executor.submit(transfer, group) for group in groups]):
            completed += future.result()
            print(json.dumps({"environment": environment, "phase": "images", "completed": completed,
                              "total": len(missing)}), flush=True)
    artifacts = {name: digest_file(pending / name) for name in ("database.dump", "globals.sql", "config.tar.gz", "database-keys.tar.gz", "storage-manifest.json")}
    metadata = {"format": 1, "environment": environment, "startedAt": started, "completedAt": now(),
                "bootId": boot_id, "fileCount": manifest["fileCount"], "imageBytes": manifest["bytes"],
                "downloadedBytes": transferred, "seededFiles": seeded, "artifacts": artifacts}
    atomic_json(pending / "backup.json", metadata)
    verify_snapshot(root, pending)
    snapshot = root / "snapshots" / name
    os.replace(pending, snapshot)
    atomic_json(root / "latest.json", {"snapshot": name, **metadata})
    retention(root, config.get("keepSnapshots", 30))
    print(json.dumps({"environment": environment, "phase": "complete", "snapshot": name,
                      "files": manifest["fileCount"], "downloadedBytes": transferred}), flush=True)
    return {"snapshot": name, **metadata}


@contextlib.contextmanager
def execution_lock(root):
    with (root / "run.lock").open("a+b") as lock:
        lock.seek(0)
        lock.write(b"0")
        lock.flush()
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, type=pathlib.Path)
    parser.add_argument("--boot-id", default="manual")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding="utf-8-sig"))
    root = pathlib.Path(config["root"])
    root.mkdir(parents=True, exist_ok=True)
    with execution_lock(root):
        status = {"state": "running", "startedAt": now(), "bootId": args.boot_id, "environments": {}}
        atomic_json(root / "backup-status.json", status)
        try:
            for environment in ("production", "development"):
                latest = root / environment / "latest.json"
                previous = json.loads(latest.read_text(encoding="utf-8")) if latest.exists() else None
                if args.verify:
                    if not previous or not STAMP.fullmatch(previous["snapshot"]):
                        raise ValueError("No completed local backup")
                    result = verify_snapshot(root / environment, root / environment / "snapshots" / previous["snapshot"])
                elif not args.force and previous and previous.get("bootId") == args.boot_id:
                    result = previous
                    print(json.dumps({"environment": environment, "phase": "already-backed-up-this-boot"}), flush=True)
                else:
                    result = backup(config, environment, args.boot_id)
                status["environments"][environment] = result
                atomic_json(root / "backup-status.json", status)
            status.update(state="complete", completedAt=now())
            atomic_json(root / "backup-status.json", status)
        except Exception as error:
            status.update(state="failed", failedAt=now(), error=str(error))
            atomic_json(root / "backup-status.json", status)
            raise


if __name__ == "__main__":
    main()
