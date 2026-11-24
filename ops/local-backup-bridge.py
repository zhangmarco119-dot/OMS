#!/usr/bin/env python3
"""Read-only, forced-command SSH exporter. No archive is written on the server."""
import base64
import hashlib
import json
import os
import pathlib
import stat
import subprocess
import sys


def safe_parts(value):
    if not isinstance(value, str) or not value or value.startswith("/") or "\0" in value:
        raise ValueError("Invalid storage path")
    parts = value.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise ValueError("Invalid storage path")
    return parts


def open_file(root, relative):
    parts = safe_parts(relative)
    directory = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = child
        descriptor = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    finally:
        os.close(directory)
    if not stat.S_ISREG(os.fstat(descriptor).st_mode):
        os.close(descriptor)
        raise ValueError("Storage entry is not a regular file")
    return os.fdopen(descriptor, "rb")


def attributes(path, info):
    return {
        "mode": stat.S_IMODE(info.st_mode), "uid": info.st_uid, "gid": info.st_gid,
        "mtimeNs": info.st_mtime_ns,
        "xattrs": {key: base64.b64encode(os.getxattr(path, key)).decode("ascii")
                   for key in os.listxattr(path)},
    }


def inventory(root):
    files, directories = [], []
    for base, children, names in os.walk(root, followlinks=False):
        current = pathlib.Path(base)
        for name in children:
            if (current / name).is_symlink():
                raise ValueError("Storage contains a symbolic link")
        relative = current.relative_to(root).as_posix()
        directories.append({"path": "" if relative == "." else relative, **attributes(current, current.stat())})
        for name in sorted(names):
            path = (current / name).relative_to(root).as_posix()
            digest = hashlib.sha256()
            with open_file(root, path) as source:
                before = os.fstat(source.fileno())
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
                after = os.fstat(source.fileno())
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError("Storage changed during inventory; retry backup")
                files.append({"path": path, "size": after.st_size, "sha256": digest.hexdigest(),
                              **attributes(source.fileno(), after)})
    return {"format": 1, "files": files, "directories": directories,
            "fileCount": len(files), "bytes": sum(item["size"] for item in files)}


def frame(value):
    sys.stdout.buffer.write(json.dumps(value, separators=(",", ":")).encode() + b"\n")
    sys.stdout.buffer.flush()


def main():
    line = sys.stdin.buffer.readline(2 * 1024 * 1024 + 1)
    if len(line) > 2 * 1024 * 1024:
        raise ValueError("Request is too large")
    request = json.loads(line)
    environment = request.get("environment")
    if environment not in ("production", "development"):
        raise ValueError("Invalid environment")
    root = pathlib.Path("/opt/storehub-" + environment)
    storage = pathlib.Path("/var/lib/docker/volumes/supabase_storage_storehub-local-" + environment + "/_data")
    database = "supabase_db_storehub-local-" + environment
    action = request.get("action")
    if action == "inventory":
        frame(inventory(storage))
    elif action == "database":
        subprocess.run(["docker", "exec", database, "pg_dump", "-U", "supabase_admin", "-d", "postgres",
                        "-Fc", "--lock-wait-timeout=30000"], stdout=sys.stdout.buffer, check=True)
    elif action == "globals":
        subprocess.run(["docker", "exec", database, "pg_dumpall", "-U", "postgres", "--globals-only"],
                       stdout=sys.stdout.buffer, check=True)
    elif action == "database-keys":
        subprocess.run(["docker", "exec", "-u", "0", database, "tar", "-czf", "-", "-C",
                        "/etc/postgresql-custom", "pgsodium_root.key"], stdout=sys.stdout.buffer, check=True)
    elif action == "config":
        allowed = ["compose.json", "public-gateway.json", "runtime-secrets.json", "cloud-origin-secrets.json",
                   "functions", "letsencrypt", "nginx.conf", "nginx-cloud.conf", "cloud-nginx.conf",
                   "nginx-http.conf", "nginx-https.conf", "renew-https.sh"]
        names = [name for name in allowed if (root / name).exists()]
        subprocess.run(["tar", "--xattrs", "--xattrs-include=*", "-czf", "-", "-C", str(root), "--", *names],
                       stdout=sys.stdout.buffer, check=True)
    elif action == "assets":
        wanted = request.get("files")
        if not isinstance(wanted, list) or len(wanted) > 256:
            raise ValueError("Invalid asset batch")
        for item in wanted:
            with open_file(storage, item["path"]) as source:
                before = os.fstat(source.fileno())
                if before.st_size != item["size"]:
                    raise ValueError("Storage changed before transfer; retry backup")
                frame({"path": item["path"], "size": before.st_size})
                digest = hashlib.sha256()
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
                    sys.stdout.buffer.write(block)
                after = os.fstat(source.fileno())
                if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                    raise ValueError("Storage changed during transfer; retry backup")
                frame({"sha256": digest.hexdigest()})
        frame({"done": True, "count": len(wanted)})
    else:
        raise ValueError("Unsupported read-only backup action")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Backup export failed: " + str(error), file=sys.stderr)
        sys.exit(1)
