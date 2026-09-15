import subprocess
import unittest
from unittest.mock import MagicMock, patch

from local_safety_guard import SafetySample, redline, run_guarded_worker


class LocalGuardTests(unittest.TestCase):
    def test_normal_and_warm_samples_are_allowed(self):
        for temperature in (40, 65, 77, 84):
            self.assertIsNone(redline(SafetySample(temperature, 512)))

    def test_only_critical_heat_or_unprovable_memory_stops(self):
        self.assertEqual(redline(SafetySample(85, 512)), "TERMINAL_THERMAL_REDLINE")
        self.assertEqual(redline(SafetySample(None, 100)), "TERMINAL_MEMORY_REDLINE")
        self.assertEqual(redline(SafetySample(40, None)), "TERMINAL_MEMORY_REDLINE")
        self.assertEqual(redline(SafetySample(40, float("nan"))), "TERMINAL_MEMORY_REDLINE")

    @patch("local_safety_guard.os.name", "posix")
    @patch("local_safety_guard.subprocess.Popen")
    def test_rejects_before_launch(self, launch):
        notify = MagicMock()
        result = run_guarded_worker(["worker"], notify, sample=lambda: SafetySample(90, 1024))
        launch.assert_not_called()
        notify.assert_called_once_with("TERMINAL_THERMAL_REDLINE")
        self.assertEqual(result.protection_reason, "TERMINAL_THERMAL_REDLINE")

    @patch("local_safety_guard.os.name", "posix")
    @patch("local_safety_guard._stop_owned_group")
    @patch("local_safety_guard.subprocess.Popen")
    def test_stops_owned_worker_before_network_notification(self, launch, stop):
        worker = launch.return_value
        worker.poll.side_effect = [None, -15]
        worker.returncode = -15
        order = []
        stop.side_effect = lambda *_: order.append("stopped")
        samples = iter([SafetySample(40, 1000), SafetySample(90, 1000)])
        def notify(reason):
            order.append("reported")
            raise ConnectionError("offline")
        result = run_guarded_worker(["worker", "--local"], notify, sample=lambda: next(samples))
        self.assertEqual(order, ["stopped", "reported"])
        self.assertEqual(result.returncode, -15)
        self.assertEqual(result.report_error, "offline")
        launch.assert_called_once_with(["worker", "--local"], start_new_session=True, shell=False)

    @patch("local_safety_guard.os.killpg", create=True)
    def test_noncooperative_child_is_killed_and_reaped(self, killpg):
        from local_safety_guard import _stop_owned_group
        worker = MagicMock(pid=123)
        worker.wait.side_effect = [subprocess.TimeoutExpired("worker", 1), -9]
        # Windows does not define SIGKILL, but this code is deployed on Linux only.
        with patch("local_safety_guard.signal.SIGKILL", 9, create=True):
            _stop_owned_group(worker, 1)
        self.assertEqual(killpg.call_count, 2)
        self.assertEqual(worker.wait.call_count, 2)


if __name__ == "__main__":
    unittest.main()
