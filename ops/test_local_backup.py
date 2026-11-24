import hashlib
import io
import json
import pathlib
import runpy
import tempfile
import unittest
from unittest import mock

MODULE = runpy.run_path(str(pathlib.Path(__file__).with_name("local-backup.py")))
BRIDGE = runpy.run_path(str(pathlib.Path(__file__).with_name("local-backup-bridge.py")))


def image(path, data):
    return {"path": path, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def frame(value):
    return json.dumps(value).encode() + b"\n"


def snapshot(root, stamp, data):
    directory = root / "snapshots" / stamp
    directory.mkdir(parents=True)
    item = image("bucket/photo.jpg/version", data)
    blob = MODULE["blob_path"](root, item["sha256"])
    blob.parent.mkdir(parents=True, exist_ok=True)
    blob.write_bytes(data)
    manifest = {"format": 1, "files": [item], "directories": [], "fileCount": 1, "bytes": len(data)}
    (directory / "storage-manifest.json").write_text(json.dumps(manifest))
    for name, content in {"database.dump": b"PGDMPfixture", "globals.sql": b"-- globals", "config.tar.gz": b"fixture", "database-keys.tar.gz": b"encryption key fixture"}.items():
        (directory / name).write_bytes(content)
    artifacts = {name: MODULE["digest_file"](directory / name)
                 for name in ("database.dump", "globals.sql", "config.tar.gz", "database-keys.tar.gz", "storage-manifest.json")}
    (directory / "backup.json").write_text(json.dumps({"format": 1, "artifacts": artifacts}))
    return directory, blob


class LocalBackupTests(unittest.TestCase):
    def test_unsafe_paths_are_rejected_and_non_windows_names_are_preserved(self):
        for name in ("/etc/passwd", "../file", "bucket/../file", "bucket//file", "bucket/./file"):
            with self.assertRaises(ValueError):
                BRIDGE["safe_parts"](name)
        self.assertEqual(BRIDGE["safe_parts"]("bucket/货品?:照片.jpg/version"), ["bucket", "货品?:照片.jpg", "version"])

    def test_interruption_keeps_finished_blobs_and_never_publishes_partial_images(self):
        with tempfile.TemporaryDirectory(prefix="storehub-local-backup-test-") as temporary:
            root = pathlib.Path(temporary)
            first, second = image("one", b"photo-one"), image("two", b"photo-two")
            stream = io.BytesIO(frame({"path": "one", "size": 9}) + b"photo-one" + frame({"sha256": first["sha256"]})
                                + frame({"path": "two", "size": 9}) + b"part")
            with self.assertRaises(ValueError):
                MODULE["receive_assets"](stream, [first, second], root)
            self.assertEqual(MODULE["blob_path"](root, first["sha256"]).read_bytes(), b"photo-one")
            self.assertFalse(MODULE["blob_path"](root, second["sha256"]).exists())
            self.assertFalse(list(root.rglob("*.part")))

    def test_bad_transfer_hash_does_not_replace_an_existing_verified_image(self):
        with tempfile.TemporaryDirectory(prefix="storehub-local-backup-test-") as temporary:
            root = pathlib.Path(temporary)
            item = image("one", b"good")
            target = MODULE["blob_path"](root, item["sha256"])
            target.parent.mkdir(parents=True)
            target.write_bytes(b"good")
            stream = io.BytesIO(frame({"path": "one", "size": 4}) + b"evil" + frame({"sha256": item["sha256"]}))
            with self.assertRaises(ValueError):
                MODULE["receive_assets"](stream, [item], root)
            self.assertEqual(target.read_bytes(), b"good")

    def test_snapshot_verification_detects_missing_or_corrupted_photos(self):
        with tempfile.TemporaryDirectory(prefix="storehub-local-backup-test-") as temporary:
            root = pathlib.Path(temporary)
            directory, blob = snapshot(root, "20261124T010000Z-aaaaaaaa", b"original")
            MODULE["verify_snapshot"](root, directory)
            blob.write_bytes(b"tampered")
            with self.assertRaises(ValueError):
                MODULE["verify_snapshot"](root, directory)

    def test_retention_keeps_baseline_and_recent_referenced_content(self):
        with tempfile.TemporaryDirectory(prefix="storehub-local-backup-test-") as temporary:
            root = pathlib.Path(temporary)
            copies = [snapshot(root, "20261124T0%d0000Z-aaaaaaaa" % i, ("photo-%d" % i).encode()) for i in range(4)]
            unknown = root / "blobs" / "00" / "unrelated.txt"
            unknown.parent.mkdir(exist_ok=True)
            unknown.write_text("keep")
            MODULE["retention"](root, 2)
            self.assertTrue(copies[0][0].exists())
            self.assertFalse(copies[1][0].exists())
            self.assertFalse(copies[1][1].exists())
            self.assertTrue(copies[2][1].exists())
            self.assertTrue(copies[3][1].exists())
            self.assertTrue(unknown.exists())

    def test_failed_export_never_overwrites_latest_completed_snapshot(self):
        with tempfile.TemporaryDirectory(prefix="storehub-local-backup-test-") as temporary:
            root = pathlib.Path(temporary)
            (root / "production").mkdir()
            latest = root / "production" / "latest.json"
            latest.write_text('{"snapshot":"previous-good-backup"}')
            function = MODULE["backup"]
            with mock.patch.dict(function.__globals__, export_file=mock.Mock(side_effect=RuntimeError("network offline"))):
                with self.assertRaises(RuntimeError):
                    function({"root": str(root)}, "production", "boot-1")
            self.assertEqual(json.loads(latest.read_text())["snapshot"], "previous-good-backup")


if __name__ == "__main__":
    unittest.main()
