import os
import subprocess
import threading
import time
import uuid as _uuid
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.db import connection
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from .models import BackupRecord, BackupSchedule, HealthCheck, RestoreRecord

# ── config ──────────────────────────────────────────────────────────────────────

BACKUP_DIR = Path(settings.BASE_DIR) / "backups"
BACKUP_DIR.mkdir(parents=True, exist_ok=True)


def _get_db_config():
    """Pull the database credentials from Django settings."""
    db = settings.DATABASES["default"]
    return {
        "name": db["NAME"],
        "user": db["USER"],
        "password": db["PASSWORD"],
        "host": db.get("HOST", "localhost"),
        "port": db.get("PORT", "5432"),
    }


def _pg_env(cfg):
    """Return a copy of os.environ with PGPASSWORD set."""
    env = os.environ.copy()
    env["PGPASSWORD"] = cfg["password"]
    return env


# ── helpers ─────────────────────────────────────────────────────────────────────


def _run_backup(record_id):
    """Run pg_dump in a background thread and update the BackupRecord."""
    cfg = _get_db_config()
    record = BackupRecord.objects.get(id=record_id)
    dump_path = str(BACKUP_DIR / f"{record.id}.dump")

    cmd = [
        "pg_dump",
        "-h",
        cfg["host"],
        "-p",
        cfg["port"],
        "-U",
        cfg["user"],
        "-Fc",  # custom format, needed for pg_restore
        "-f",
        dump_path,
        cfg["name"],
    ]

    start = time.time()
    try:
        result = subprocess.run(
            cmd,
            env=_pg_env(cfg),
            capture_output=True,
            text=True,
            timeout=600,  # 10 minute safety timeout
        )
        elapsed_ms = int((time.time() - start) * 1000)

        if result.returncode != 0:
            record.status = "failed"
            record.error_message = result.stderr[:2000]
            record.duration_ms = elapsed_ms
            record.save()
            return

        file_size = os.path.getsize(dump_path) if os.path.exists(dump_path) else 0
        record.status = "success"
        record.duration_ms = elapsed_ms
        record.size_bytes = file_size
        record.file_path = dump_path
        record.save()

    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.time() - start) * 1000)
        record.status = "failed"
        record.error_message = "Backup timed out after 10 minutes."
        record.duration_ms = elapsed_ms
        record.save()
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        record.status = "failed"
        record.error_message = str(e)[:2000]
        record.duration_ms = elapsed_ms
        record.save()


def _run_restore(dump_path, restore_record_id):
    """
    Run pg_restore in a background thread and update the RestoreRecord.
    """
    cfg = _get_db_config()

    cmd = [
        "pg_restore",
        "-h",
        cfg["host"],
        "-p",
        cfg["port"],
        "-U",
        cfg["user"],
        "-d",
        cfg["name"],
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        dump_path,
    ]

    start = time.time()
    try:
        record = RestoreRecord.objects.get(id=restore_record_id)
        result = subprocess.run(
            cmd,
            env=_pg_env(cfg),
            capture_output=True,
            text=True,
            timeout=600,
        )
        elapsed_ms = int((time.time() - start) * 1000)
        record.duration_ms = elapsed_ms
        record.finished_at = timezone.now()

        if result.returncode != 0:
            record.status = "failed"
            record.error_message = result.stderr[:2000]
        else:
            record.status = "success"
        record.save()
    except subprocess.TimeoutExpired:
        elapsed_ms = int((time.time() - start) * 1000)
        try:
            record = RestoreRecord.objects.get(id=restore_record_id)
            record.status = "failed"
            record.error_message = "Restore timed out after 10 minutes."
            record.duration_ms = elapsed_ms
            record.finished_at = timezone.now()
            record.save()
        except Exception:
            pass
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        try:
            record = RestoreRecord.objects.get(id=restore_record_id)
            record.status = "failed"
            record.error_message = str(e)[:2000]
            record.duration_ms = elapsed_ms
            record.finished_at = timezone.now()
            record.save()
        except Exception:
            pass


# ── views ───────────────────────────────────────────────────────────────────────


def _sync_orphaned_backups():
    """
    Scan the backup folder for .dump files that have no matching
    BackupRecord and create records for them so they appear in the UI.
    """
    cfg = _get_db_config()
    existing_ids = set(
        str(pk) for pk in BackupRecord.objects.values_list("id", flat=True)
    )

    for dump_file in BACKUP_DIR.glob("*.dump"):
        file_uuid = dump_file.stem  # filename without extension
        if file_uuid in existing_ids:
            continue

        # validate UUID format
        try:
            parsed = _uuid.UUID(file_uuid)
        except ValueError:
            continue

        file_size = dump_file.stat().st_size
        file_mtime = timezone.datetime.fromtimestamp(
            dump_file.stat().st_mtime, tz=timezone.utc
        )

        record = BackupRecord.objects.create(
            id=parsed,
            db_name=cfg["name"],
            status="success",
            size_bytes=file_size,
            file_path=str(dump_file),
        )
        # auto_now_add ignores values passed to create(), so update directly
        BackupRecord.objects.filter(id=parsed).update(created_at=file_mtime)


@api_view(["GET"])
def list_backups(request):
    """List all backup records, optionally filtered by db_name."""
    # sync orphaned dump files from the backup folder into the DB
    _sync_orphaned_backups()

    db_name = request.GET.get("db_name")
    qs = BackupRecord.objects.all()
    if db_name:
        qs = qs.filter(db_name=db_name)

    data = []
    for b in qs:
        data.append(
            {
                "id": str(b.id),
                "db_name": b.db_name,
                "created_at": b.created_at.isoformat(),
                "status": b.status,
                "size_bytes": b.size_bytes,
                "duration_ms": b.duration_ms,
                "file_path": b.file_path,
                "error_message": b.error_message,
            }
        )

    return Response(data)


@api_view(["POST"])
def create_backup(request):
    """
    Kick off a new pg_dump backup in a background thread.
    Returns the backup record immediately with status 'in_progress'.
    """
    cfg = _get_db_config()
    db_name = request.data.get("db_name", cfg["name"])

    record = BackupRecord.objects.create(
        db_name=db_name,
        status="in_progress",
    )

    thread = threading.Thread(target=_run_backup, args=(record.id,), daemon=True)
    thread.start()

    return Response(
        {
            "id": str(record.id),
            "db_name": record.db_name,
            "created_at": record.created_at.isoformat(),
            "status": record.status,
            "size_bytes": record.size_bytes,
            "duration_ms": record.duration_ms,
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
def get_backup(request, backup_id):
    """Get a single backup record by ID (used for polling status)."""
    try:
        b = BackupRecord.objects.get(id=backup_id)
    except BackupRecord.DoesNotExist:
        return Response(
            {"error": "Backup not found."}, status=status.HTTP_404_NOT_FOUND
        )

    return Response(
        {
            "id": str(b.id),
            "db_name": b.db_name,
            "created_at": b.created_at.isoformat(),
            "status": b.status,
            "size_bytes": b.size_bytes,
            "duration_ms": b.duration_ms,
            "file_path": b.file_path,
            "error_message": b.error_message,
        }
    )


@api_view(["DELETE"])
def delete_backup(request, backup_id):
    """Delete a backup record and its dump file from disk."""
    try:
        b = BackupRecord.objects.get(id=backup_id)
    except BackupRecord.DoesNotExist:
        return Response(
            {"error": "Backup not found."}, status=status.HTTP_404_NOT_FOUND
        )

    if b.status == "in_progress":
        return Response(
            {"error": "Cannot delete an in-progress backup."},
            status=status.HTTP_409_CONFLICT,
        )

    # remove file from disk
    if b.file_path and os.path.exists(b.file_path):
        try:
            os.remove(b.file_path)
        except OSError:
            pass

    b.delete()
    return Response({"message": "Backup deleted."}, status=status.HTTP_200_OK)


@api_view(["POST"])
def restore_backup(request, backup_id):
    """
    Restore the database from a backup.
    Kicks off pg_restore in a background thread and returns immediately.
    Creates a RestoreRecord to track progress.
    """
    try:
        b = BackupRecord.objects.get(id=backup_id)
    except BackupRecord.DoesNotExist:
        return Response(
            {"error": "Backup not found."}, status=status.HTTP_404_NOT_FOUND
        )

    if b.status != "success":
        return Response(
            {"error": "Can only restore from a successful backup."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not b.file_path or not os.path.exists(b.file_path):
        return Response(
            {"error": "Backup file not found on disk."},
            status=status.HTTP_404_NOT_FOUND,
        )

    restore_record = RestoreRecord.objects.create(
        db_name=b.db_name,
        source_backup=b,
        source_backup_created_at=b.created_at,
        status="in_progress",
    )

    thread = threading.Thread(
        target=_run_restore,
        args=(b.file_path, restore_record.id),
        daemon=True,
    )
    thread.start()

    return Response(
        {
            "restore_id": str(restore_record.id),
            "backup_id": str(b.id),
            "db_name": restore_record.db_name,
            "started_at": restore_record.started_at.isoformat(),
            "status": restore_record.status,
            "source_backup_created_at": b.created_at.isoformat(),
        },
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
def get_restore(request, restore_id):
    """Poll a single restore record by ID."""
    try:
        r = RestoreRecord.objects.get(id=restore_id)
    except RestoreRecord.DoesNotExist:
        return Response(
            {"error": "Restore record not found."}, status=status.HTTP_404_NOT_FOUND
        )

    return Response(_serialize_restore(r))


@api_view(["GET"])
def list_restores(request):
    """List restore records, optionally filtered by db_name."""
    db_name = request.GET.get("db_name")
    qs = RestoreRecord.objects.all()
    if db_name:
        qs = qs.filter(db_name=db_name)

    return Response([_serialize_restore(r) for r in qs])


def _serialize_restore(r):
    return {
        "id": str(r.id),
        "db_name": r.db_name,
        "source_backup_id": str(r.source_backup_id) if r.source_backup_id else None,
        "source_backup_created_at": r.source_backup_created_at.isoformat()
        if r.source_backup_created_at
        else None,
        "started_at": r.started_at.isoformat(),
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "status": r.status,
        "duration_ms": r.duration_ms,
        "error_message": r.error_message,
    }


# ── health checks ──────────────────────────────────────────────────────────────


@api_view(["GET"])
def list_health_checks(request):
    """
    Return health checks for the last 90 days.
    Each day has at most one entry. Days with no entry are treated as 'no data'.
    Optionally filtered by db_name.
    """
    db_name = request.GET.get("db_name", _get_db_config()["name"])
    since = timezone.now() - timedelta(days=90)
    qs = HealthCheck.objects.filter(db_name=db_name, checked_at__gte=since)

    data = []
    for h in qs:
        data.append(
            {
                "id": str(h.id),
                "db_name": h.db_name,
                "checked_at": h.checked_at.isoformat(),
                "status": h.status,
                "response_time_ms": h.response_time_ms,
                "error_message": h.error_message,
            }
        )

    return Response(data)


@api_view(["POST"])
def run_health_check(request):
    """
    Run a health check right now: ping the database and record the result.
    """
    cfg = _get_db_config()
    db_name = request.data.get("db_name", cfg["name"])

    start = time.time()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        elapsed_ms = int((time.time() - start) * 1000)

        record = HealthCheck.objects.create(
            db_name=db_name,
            status="success",
            response_time_ms=elapsed_ms,
        )
    except Exception as e:
        elapsed_ms = int((time.time() - start) * 1000)
        record = HealthCheck.objects.create(
            db_name=db_name,
            status="failed",
            response_time_ms=elapsed_ms,
            error_message=str(e)[:2000],
        )

    return Response(
        {
            "id": str(record.id),
            "db_name": record.db_name,
            "checked_at": record.checked_at.isoformat(),
            "status": record.status,
            "response_time_ms": record.response_time_ms,
            "error_message": record.error_message,
        }
    )


@api_view(["GET"])
def list_schedules(request):
    """List all backup schedules."""
    schedules = BackupSchedule.objects.all()
    return Response([_serialize_schedule(s) for s in schedules])


@api_view(["POST"])
def save_schedule(request):
    """
    Create or update a BackupSchedule for a given db_name.
    If one already exists for that db_name, it is updated.
    """
    from . import scheduler as sched_module

    db_name = request.data.get("db_name")
    if not db_name:
        return Response(
            {"error": "db_name is required."}, status=status.HTTP_400_BAD_REQUEST
        )

    frequency = request.data.get("frequency", "daily")
    enabled = request.data.get("enabled", True)
    hour = int(request.data.get("hour", 2))
    minute = int(request.data.get("minute", 0))
    day_of_week = request.data.get("day_of_week")
    day_of_month = request.data.get("day_of_month")
    cron_expression = request.data.get("cron_expression", "")
    retain_last_n = int(request.data.get("retain_last_n", 7))

    if day_of_week is not None:
        day_of_week = int(day_of_week)
    if day_of_month is not None:
        day_of_month = int(day_of_month)

    # validate cron expression if custom
    if frequency == "custom" and cron_expression:
        parts = cron_expression.strip().split()
        if len(parts) != 5:
            return Response(
                {
                    "error": "Custom cron expression must have exactly 5 fields: minute hour day month weekday."
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

    sched, created = BackupSchedule.objects.update_or_create(
        db_name=db_name,
        defaults={
            "frequency": frequency,
            "enabled": enabled,
            "hour": hour,
            "minute": minute,
            "day_of_week": day_of_week,
            "day_of_month": day_of_month,
            "cron_expression": cron_expression,
            "retain_last_n": retain_last_n,
        },
    )

    # register / update the APScheduler job
    try:
        sched_module.register_schedule(sched)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
    except Exception as e:
        return Response(
            {"error": f"Schedule saved but failed to register job: {e}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    sched.refresh_from_db()
    return Response(
        _serialize_schedule(sched),
        status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
    )


@api_view(["POST"])
def toggle_schedule(request, schedule_id):
    """Enable or disable a schedule without deleting it."""
    from . import scheduler as sched_module

    try:
        sched = BackupSchedule.objects.get(id=schedule_id)
    except BackupSchedule.DoesNotExist:
        return Response(
            {"error": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
        )

    sched.enabled = not sched.enabled
    sched.save(update_fields=["enabled", "updated_at"])

    try:
        sched_module.register_schedule(sched)
    except Exception:
        pass

    sched.refresh_from_db()
    return Response(_serialize_schedule(sched))


@api_view(["DELETE"])
def delete_schedule(request, schedule_id):
    """Delete a schedule and remove the APScheduler job."""
    from . import scheduler as sched_module

    try:
        sched = BackupSchedule.objects.get(id=schedule_id)
    except BackupSchedule.DoesNotExist:
        return Response(
            {"error": "Schedule not found."}, status=status.HTTP_404_NOT_FOUND
        )

    sched_module.deregister_schedule(sched.db_name)
    sched.delete()
    return Response({"message": "Schedule deleted."})


@api_view(["POST"])
def preview_next_runs(request):
    """
    Given schedule params, return the next 5 scheduled run times (preview only, nothing saved).
    """
    import datetime

    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.util import datetime_to_utc_timestamp

    frequency = request.data.get("frequency", "daily")
    hour = int(request.data.get("hour", 2))
    minute = int(request.data.get("minute", 0))
    day_of_week = request.data.get("day_of_week")
    day_of_month = request.data.get("day_of_month")
    cron_expression = request.data.get("cron_expression", "")

    # Build a temporary BackupSchedule-like object
    class _FakeSched:
        pass

    fake = _FakeSched()
    fake.frequency = frequency
    fake.hour = hour
    fake.minute = minute
    fake.day_of_week = int(day_of_week) if day_of_week is not None else None
    fake.day_of_month = int(day_of_month) if day_of_month is not None else None
    fake.cron_expression = cron_expression

    from . import scheduler as sched_module

    try:
        trigger = sched_module._build_trigger(fake)
    except ValueError as e:
        return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    runs = []
    prev = now
    for _ in range(5):
        next_fire = trigger.get_next_fire_time(prev, prev)
        if next_fire is None:
            break
        runs.append(next_fire.isoformat())
        prev = next_fire + datetime.timedelta(seconds=1)

    return Response({"next_runs": runs})


def _serialize_schedule(s):
    return {
        "id": str(s.id),
        "db_name": s.db_name,
        "enabled": s.enabled,
        "frequency": s.frequency,
        "hour": s.hour,
        "minute": s.minute,
        "day_of_week": s.day_of_week,
        "day_of_month": s.day_of_month,
        "cron_expression": s.cron_expression,
        "retain_last_n": s.retain_last_n,
        "last_run_at": s.last_run_at.isoformat() if s.last_run_at else None,
        "next_run_at": s.next_run_at.isoformat() if s.next_run_at else None,
        "created_at": s.created_at.isoformat(),
        "updated_at": s.updated_at.isoformat(),
    }


@api_view(["GET"])
def db_info(request):
    """
    Return metadata about the configured databases.
    Currently just the default database from settings.
    """
    _sync_orphaned_backups()
    cfg = _get_db_config()

    db_size = None
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT pg_database_size(%s)",
                [cfg["name"]],
            )
            row = cursor.fetchone()
            db_size = row[0] if row else None
    except Exception:
        pass

    # count backups
    backup_count = BackupRecord.objects.filter(db_name=cfg["name"]).count()
    last_backup = BackupRecord.objects.filter(
        db_name=cfg["name"], status="success"
    ).first()

    databases = [
        {
            "id": cfg["name"],
            "name": f"{cfg['name']} (PostgreSQL)",
            "engine": "postgresql",
            "host": cfg["host"],
            "port": cfg["port"],
            "size_bytes": db_size,
            "backup_count": backup_count,
            "last_backup_at": last_backup.created_at.isoformat()
            if last_backup
            else None,
            "status": "online",
        }
    ]

    return Response(databases)
