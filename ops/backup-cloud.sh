#!/bin/bash
set -euo pipefail
umask 077

environment=${1:?Specify production or development}
case "$environment" in production|development) ;; *) exit 2 ;; esac
root="/opt/storehub-$environment"
backups="$root/backups"
storage="/var/lib/docker/volumes/supabase_storage_storehub-local-$environment/_data"
database="supabase_db_storehub-local-$environment"

# Both environments share a physical disk; prevent concurrent full copies.
exec 9>/run/lock/storehub-backup.lock
flock -n 9 || { echo 'Another StoreHub backup is running' >&2; exit 1; }
install -d -m 700 "$backups"
python3 "$root/maintain-backups.py" --root "$backups" --apply
actual=$(docker volume inspect "supabase_storage_storehub-local-$environment" --format '{{.Mountpoint}}')
test "$actual" = "$storage"

# Do not consume the last free bytes even if the storage volume grows abruptly.
storage_bytes=$(du -sb "$storage" | cut -f1)
available_bytes=$(df -B1 --output=avail "$root" | tail -1 | tr -d ' ')
required_bytes=$((storage_bytes + storage_bytes / 5 + 2147483648))
if (( available_bytes < required_bytes )); then
  echo "Backup stopped: insufficient free space (available=$available_bytes required=$required_bytes)" >&2
  exit 1
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$backups/$stamp"
mkdir -m 700 "$target"
trap 'rm -f -- "$target/database.dump.part" "$target/storage.tar.gz.part"' EXIT
docker exec "$database" pg_dump -U supabase_admin -d postgres -Fc > "$target/database.dump.part"
mv "$target/database.dump.part" "$target/database.dump"
tar --xattrs --xattrs-include='*' -czf "$target/storage.tar.gz.part" -C "$storage" .
mv "$target/storage.tar.gz.part" "$target/storage.tar.gz"
cp "$root/compose.json" "$root/public-gateway.json" "$root/runtime-secrets.json" "$root/cloud-origin-secrets.json" "$target/"
sha256sum "$target/database.dump" "$target/storage.tar.gz" > "$target/checksums.sha256"
python3 "$root/maintain-backups.py" --root "$backups" --apply
echo "Protected $environment backup completed: $stamp"
