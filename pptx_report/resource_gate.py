"""One cross-process heavy task at a time, shared with the Node data executor."""
import functools
import os
import threading
import time
from contextlib import contextmanager

_local = threading.local()

@contextmanager
def heavy_resource_gate():
    lock_path = os.environ.get('SURVEYKIT_HEAVY_LOCK')
    if not lock_path or getattr(_local, 'held', False):
        yield
        return
    import fcntl
    with open(lock_path, 'a') as handle:
        deadline = time.monotonic() + 85
        while True:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError('其他数据或报告任务正在执行，请稍后重试。')
                time.sleep(0.2)
        _local.held = True
        try:
            yield
        finally:
            _local.held = False
            fcntl.flock(handle, fcntl.LOCK_UN)

def serialized_heavy_task(function):
    @functools.wraps(function)
    def guarded(*args, **kwargs):
        with heavy_resource_gate():
            return function(*args, **kwargs)
    return guarded
