import threading

_tokens_processed = 0
_tokens_lock = threading.Lock()


def add_processed_tokens(total_tokens: int | None) -> None:
    if total_tokens is None or total_tokens <= 0:
        return

    global _tokens_processed
    with _tokens_lock:
        _tokens_processed += total_tokens


def get_processed_tokens() -> int:
    with _tokens_lock:
        return _tokens_processed