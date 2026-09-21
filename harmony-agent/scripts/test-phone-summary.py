import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("summary", Path(__file__).with_name("summarize-phone-experiment.py"))
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class PhoneSummaryTests(unittest.TestCase):
    def fixture(self):
        trials = [dict(mode="ADAPTIVE", background=True, samplePhase="subsequent_in_session",
                       query="鞋", workflowId=f"w{i}", durationMs=duration, status=status,
                       productIds=["a", "b"], backgroundStatus="SUCCEEDED", backgroundDurationMs=1000,
                       backgroundRows=128) for i, (duration, status) in enumerate([(100, "SUCCEEDED"), (300, "FAILED")])]
        events = [dict(taskId=f"w{i}:encode", status="SUCCEEDED", queueDurationMs=10,
                       deviceState={"source": "REAL"}, telemetry={"deadlineMissed": i == 1}) for i in range(2)]
        return dict(schemaVersion=1, droppedEvents=0, trials=trials, events=events)

    def test_statistics_do_not_hide_failed_requests(self):
        row = summary.summarize(self.fixture())[0]
        self.assertEqual(row["success_rate"], .5)
        self.assertEqual(row["success_p95_ms"], 100)
        self.assertEqual(row["all_outcomes_p95_ms"], 300)
        self.assertEqual(row["deadline_miss_rate"], .5)
        self.assertEqual(row["background_rows_per_second"], 128)

    def test_quality_requires_independent_labels_and_counts_failed_queries(self):
        self.assertIsNone(summary.summarize(self.fixture())[0]["recall_at_20"])
        row = summary.summarize(self.fixture(), {"鞋": ["a", "c"]})[0]
        self.assertEqual(row["recall_at_20"], .25)
        self.assertEqual(row["labeled_samples"], 2)

    def test_injected_samples_are_separated(self):
        data = self.fixture()
        data["events"][0]["deviceState"]["source"] = "MIXED"
        self.assertEqual(len(summary.summarize(data)), 2)

    def test_overflow_is_rejected(self):
        data = self.fixture()
        data["droppedEvents"] = 1
        with self.assertRaises(ValueError):
            summary.summarize(data)


if __name__ == "__main__":
    unittest.main()
