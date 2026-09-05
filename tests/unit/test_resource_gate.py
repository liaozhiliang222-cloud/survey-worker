import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pptx_report.resource_gate import heavy_resource_gate

@unittest.skipUnless(os.name == 'posix', 'Linux flock integration')
class ResourceGateTest(unittest.TestCase):
    def test_python_and_executor_share_lock_and_release_after_kill(self):
        with tempfile.TemporaryDirectory() as directory:
            lock = str(Path(directory) / 'heavy.lock')
            with patch.dict(os.environ, {'SURVEYKIT_HEAVY_LOCK': lock}):
                with heavy_resource_gate():
                    with heavy_resource_gate():
                        self.assertEqual(subprocess.run(['flock', '-n', '-E', '75', lock, 'true']).returncode, 75)
                child = subprocess.Popen(['flock', '--no-fork', lock, 'sleep', '5'])
                try:
                    deadline = time.monotonic() + 2
                    while subprocess.run(['flock', '-n', '-E', '75', lock, 'true']).returncode == 0:
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(0.01)
                finally:
                    child.kill()
                    child.wait()
                self.assertEqual(subprocess.run(['flock', '-n', '-E', '75', lock, 'true']).returncode, 0)

if __name__ == '__main__':
    unittest.main()
