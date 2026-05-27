import logging
import os
import sqlite3
from pathlib import Path
import shutil
import subprocess

from sqlalchemy.engine import make_url
import uvicorn

from app.core.config import get_settings


logger = logging.getLogger(__name__)

APP_TABLES = {
    "users",
    "devices",
    "model_configs",
    "api_keys",
    "chats",
    "chat_messages",
    "inference_jobs",
    "app_settings",
}

INITIAL_TABLES = {
    "users",
    "devices",
    "model_configs",
    "api_keys",
    "chats",
    "chat_messages",
    "inference_jobs",
}

CHAT_METADATA_COLUMNS = {
    "model_name",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "elapsed_seconds",
    "tokens_per_second",
}


def _configure_logging() -> None:
    settings = get_settings()
    level_name = settings.app_log_level.upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(level=level, format="%(levelname)s %(name)s: %(message)s")


def _sqlite_database_path(database_url: str) -> Path | None:
    url = make_url(database_url)
    if not url.drivername.startswith("sqlite"):
        return None

    database = url.database
    if not database or database == ":memory:":
        return None

    path = Path(database)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _load_sqlite_schema(database_path: Path) -> tuple[set[str], dict[str, set[str]]]:
    with sqlite3.connect(database_path) as connection:
        rows = connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        tables = {str(row[0]) for row in rows}
        columns_by_table: dict[str, set[str]] = {}
        for table in tables:
            pragma_rows = connection.execute(f"PRAGMA table_info('{table}')").fetchall()
            columns_by_table[table] = {str(row[1]) for row in pragma_rows}
    return tables, columns_by_table


def _infer_legacy_revision(tables: set[str], columns_by_table: dict[str, set[str]]) -> str | None:
    user_tables = tables - {"alembic_version"}
    if not user_tables.intersection(APP_TABLES):
        return None

    if CHAT_METADATA_COLUMNS.issubset(columns_by_table.get("chat_messages", set())):
        return "0013_chat_message_metadata"

    device_columns = columns_by_table.get("devices", set())
    if {"stable_hardware_id", "stable_hardware_id_source"}.issubset(device_columns):
        return "0012_device_stable_hardware_id"

    app_settings_columns = columns_by_table.get("app_settings", set())
    if "app_settings" in tables and "auto_load_enabled_models_on_startup" not in app_settings_columns:
        return "0011_remove_auto_load_models_setting"

    gpu_pool_columns = columns_by_table.get("gpu_pools", set())
    if "vendor" in gpu_pool_columns:
        return "0010_gpu_pool_vendor"

    if "gpu_pools" in tables:
        return "0009_gpu_pool"

    model_columns = columns_by_table.get("model_configs", set())
    if "thinking_enabled" in model_columns:
        return "0008_model_thinking_enabled"

    if "activity_logs" in tables:
        return "0007_activity_log"

    if "tool_calling_enabled" in model_columns:
        return "0006_model_tool_calling_enabled"

    if "sitename" in app_settings_columns:
        return "0005_add_sitename_setting"

    if "auto_load_enabled_models_on_startup" in app_settings_columns:
        return "0004_auto_load_models_setting"

    if "priority" in model_columns:
        return "0003_model_priority"

    if "app_settings" in tables:
        return "0002_app_settings"

    if INITIAL_TABLES.issubset(tables):
        return "0001_initial"

    return None


def _run_alembic(*args: str) -> None:
    alembic_path = shutil.which("alembic")
    if not alembic_path:
        raise RuntimeError("Alembic CLI was not found in PATH")

    repo_root = Path(__file__).resolve().parent.parent
    env = os.environ.copy()
    current_pythonpath = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(repo_root) if not current_pythonpath else f"{repo_root}:{current_pythonpath}"

    command = [alembic_path, "-c", str(repo_root / "alembic.ini"), *args]
    subprocess.run(command, check=True, cwd=repo_root, env=env)


def _bridge_legacy_sqlite_database(database_path: Path) -> None:
    if not database_path.exists() or database_path.stat().st_size == 0:
        return

    tables, columns_by_table = _load_sqlite_schema(database_path)
    if "alembic_version" in tables:
        return

    revision = _infer_legacy_revision(tables, columns_by_table)
    if revision is None:
        raise RuntimeError(
            "Unable to infer Alembic revision for existing SQLite database. "
            "Back up the database and run a manual migration or recreate the volume."
        )

    logger.info("Stamping legacy SQLite database at %s to revision %s", database_path, revision)
    _run_alembic("stamp", revision)


def prepare_database() -> None:
    settings = get_settings()
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)

    database_path = _sqlite_database_path(settings.database_url)
    if database_path is not None:
        _bridge_legacy_sqlite_database(database_path)

    logger.info("Applying database migrations")
    _run_alembic("upgrade", "head")


def main() -> None:
    _configure_logging()
    prepare_database()

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.app_host, port=settings.app_port)


if __name__ == "__main__":
    main()