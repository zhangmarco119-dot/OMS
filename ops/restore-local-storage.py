#!/usr/bin/env python3
"""Materialize a verified local snapshot into a NEW, EMPTY Linux storage volume."""
import argparse
import base64
import json
import os
import pathlib
import runpy
import shutil

client = runpy.run_path(str(pathlib.Path(__file__).with_name("local-backup.py")))


def materialize(manifest, blobs, target):
    client["validate_manifest"](manifest)
    blobs = blobs.resolve(strict=True)
    target = target.resolve()
    if target == blobs or target in blobs.parents or blobs in target.parents:
        raise ValueError("Restore destination overlaps backup files")
    target.mkdir(parents=True, exist_ok=True)
    if any(target.iterdir()):
        raise ValueError("Restore destination must be empty; live volumes must never be overwritten")

    def destination(name):
        if name == "":
            return target
        if name.startswith("/") or any(part in ("", ".", "..") for part in name.split("/")):
            raise ValueError("Invalid restore path")
        result = target.joinpath(*name.split("/"))
        if target not in result.resolve().parents:
            raise ValueError("Restore path escapes destination")
        return result

    def metadata(path, item):
        if os.name != "posix":
            raise ValueError("Supabase storage restoration requires Linux file attributes")
        os.chown(path, item["uid"], item["gid"])
        os.chmod(path, item["mode"])
        for key, value in item.get("xattrs", {}).items():
            os.setxattr(path, key, base64.b64decode(value), follow_symlinks=False)
        os.utime(path, ns=(item["mtimeNs"], item["mtimeNs"]))

    for item in manifest["directories"]:
        destination(item["path"]).mkdir(parents=True, exist_ok=True)
    for item in manifest["files"]:
        source = client["blob_path"](blobs, item["sha256"])
        if source.stat().st_size != item["size"] or client["digest_file"](source) != item["sha256"]:
            raise ValueError("Restore source image is missing or corrupted")
        path = destination(item["path"])
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, path)
        metadata(path, item)
    for item in sorted(manifest["directories"], key=lambda p: len(p["path"]), reverse=True):
        metadata(destination(item["path"]), item)
    return {"restoredFiles": len(manifest["files"]), "restoredBytes": manifest["bytes"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backup-root", type=pathlib.Path, required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--target", type=pathlib.Path, required=True)
    args = parser.parse_args()
    if not client["STAMP"].fullmatch(args.snapshot):
        raise ValueError("Invalid snapshot name")
    snapshot = args.backup_root / "snapshots" / args.snapshot
    client["verify_snapshot"](args.backup_root, snapshot)
    inventory = json.loads((snapshot / "storage-manifest.json").read_text(encoding="utf-8"))
    print(json.dumps(materialize(inventory, args.backup_root, args.target)))
