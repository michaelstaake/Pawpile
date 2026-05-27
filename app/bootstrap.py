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

REVISION_ORDER = [
    "0001_initial",
    "0002_app_settings",
    "0003_model_priority",
    "0004_auto_load_models_setting",
    "0005_add_sitename_setting",
    "0006_model_tool_calling_enabled",
    "0007_activity_log",
    "0008_model_thinking_enabled",
    "0009_gpu_pool",
    "0010_gpu_pool_vendor",
    "0011_remove_auto_load_models_setting",
    "0012_device_stable_hardware_id",
    "0013_chat_message_metadata",
    "0014_model_config_sampling_defaults",
]

REVISION_INDEX = {revision: index for index, revision in enumerate(REVISION_ORDER)}


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

    # Walk revisions from oldest to newest and stop at the first one whose indicator
    # is absent.  This bottom-up scan ensures we never claim a revision higher than
    # what the schema actually supports, which prevents upgrade-head from skipping
    # migrations that were never applied.
    model_columns = columns_by_table.get("model_configs", set())
    app_settings_columns = columns_by_table.get("app_settings", set())
    device_columns = columns_by_table.get("devices", set())
    gpu_pool_columns = columns_by_table.get("gpu_pools", set())
    chat_message_columns = columns_by_table.get("chat_messages", set())

    if not INITIAL_TABLES.issubset(tables):
        return None

    if "app_settings" not in tables:
        return "0001_initial"

    if "priority" not in model_columns:
        return "0002_app_settings"

    if "auto_load_enabled_models_on_startup" not in app_settings_columns:
        return "0003_model_priority"

    if "sitename" not in app_settings_columns:
        return "0004_auto_load_models_setting"

    if "tool_calling_enabled" not in model_columns:
        return "0005_add_sitename_setting"

    if "activity_logs" not in tables:
        return "0006_model_tool_calling_enabled"

    if "thinking_enabled" not in model_columns:
        return "0007_activity_log"

    if "gpu_pools" not in tables or "pinned_pool_id" not in model_columns:
        return "0008_model_thinking_enabled"

    if "vendor" not in gpu_pool_columns:
        return "0009_gpu_pool"

    # 0011 removed auto_load_enabled_models_on_startup; reaching here confirms 0010
    # (vendor column) is present, so 0011 is applied only if auto_load is absent.
    if "auto_load_enabled_models_on_startup" in app_settings_columns:
        return "0010_gpu_pool_vendor"

    if not {"stable_hardware_id", "stable_hardware_id_source"}.issubset(device_columns):
        return "0011_remove_auto_load_models_setting"

    if not CHAT_METADATA_COLUMNS.issubset(chat_message_columns):
        return "0012_device_stable_hardware_id"

    if not {"temperature", "top_p"}.issubset(model_columns):
        return "0013_chat_message_metadata"

    return "0014_model_config_sampling_defaults"


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


def _read_stamped_revision(database_path: Path) -> str | None:
    with sqlite3.connect(database_path) as connection:
        row = connection.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
    if not row:
        return None
    return str(row[0])


def _stamp_inferred_revision(database_path: Path, inferred_revision: str, current_revision: str | None) -> None:
    if current_revision == inferred_revision:
        return

    if current_revision is None:
        logger.info("Stamping legacy SQLite database at %s to revision %s", database_path, inferred_revision)
        _run_alembic("stamp", inferred_revision)
        return

    current_rank = REVISION_INDEX.get(current_revision)
    inferred_rank = REVISION_INDEX.get(inferred_revision)
    if current_rank is None or inferred_rank is None:
        logger.warning(
            "Skipping Alembic stamp reconciliation for unknown revision state current=%s inferred=%s",
            current_revision,
            inferred_revision,
        )
        return

    if inferred_rank > current_rank:
        logger.info(
            "Stamping SQLite database at %s forward from revision %s to inferred revision %s",
            database_path,
            current_revision,
            inferred_revision,
        )
        _run_alembic("stamp", inferred_revision)
    elif inferred_rank < current_rank:
        logger.warning(
            "Stamped revision %s is ahead of actual schema level %s; "
            "correcting stamp backward so upgrade-head fills the gaps",
            current_revision,
            inferred_revision,
        )
        _run_alembic("stamp", inferred_revision)


def _reconcile_sqlite_database(database_path: Path) -> None:
    if not database_path.exists() or database_path.stat().st_size == 0:
        return

    tables, columns_by_table = _load_sqlite_schema(database_path)
    inferred_revision = _infer_legacy_revision(tables, columns_by_table)
    current_revision = _read_stamped_revision(database_path) if "alembic_version" in tables else None

    if inferred_revision is None and current_revision is None:
        raise RuntimeError(
            "Unable to infer Alembic revision for existing SQLite database. "
            "Back up the database and run a manual migration or recreate the volume."
        )

    if inferred_revision is not None:
        _stamp_inferred_revision(database_path, inferred_revision, current_revision)


def prepare_database() -> None:
    settings = get_settings()
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)

    database_path = _sqlite_database_path(settings.database_url)
    if database_path is not None:
        _reconcile_sqlite_database(database_path)

    logger.info("Applying database migrations")
    _run_alembic("upgrade", "head")


def main() -> None:
    _configure_logging()
    prepare_database()

    settings = get_settings()
    uvicorn.run("app.main:app", host=settings.app_host, port=settings.app_port)


if __name__ == "__main__":
    main()