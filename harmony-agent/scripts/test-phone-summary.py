import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("summary", Path(__file__).with_name("summarize-phone-experiment.py"))
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class PhoneSummaryTests(unittest.TestCase):
    def fixture(self):
        trials = [dict(mode="ADAPTIVE", background=True, samplePhase="subsequent_in_session",
                       query="鞋", workflowId=f"w{i}", backgroundWorkflowId=f"b{i}", durationMs=duration, status=status,
                       productIds=["a", "b"], backgroundStatus="SUCCEEDED", backgroundDurationMs=1000,
                       backgroundRows=128) for i, (duration, status) in enumerate([(100, "SUCCEEDED"), (300, "FAILED")])]
        events = [dict(taskId=f"w{i}:encode", status="SUCCEEDED", queueDurationMs=10,
                       deviceState={"source": "REAL"}, telemetry={"deadlineMissed": i == 1}) for i in range(2)]
        events += [dict(taskId=f"b{i}:task", status="SUCCEEDED", deviceState={"source": "REAL"}) for i in range(2)]
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

    def test_schema_two_separates_actual_profiles_with_same_legacy_mode(self):
        data = self.fixture()
        data["schemaVersion"] = 2
        for i, event in enumerate(data["events"][:2]):
            event["executionPlan"] = {"policyAudit": {"contractId": "search@v1", "version": "local-v1",
                "mode": "OBSERVE", "actualProfileId": "HIGH" if i == 0 else "SAFE", "cohort": "BASELINE"}}
        rows = summary.summarize(data)
        self.assertEqual(len(rows), 2)
        self.assertNotEqual(rows[0]["policy_profile_signature"], rows[1]["policy_profile_signature"])

    def test_policy_version_and_execution_path_are_not_pooled(self):
        data = self.fixture()
        for i, event in enumerate(data["events"][:2]):
            event["executionPlan"] = {"policyAudit": {"contractId": "search@v1", "version": f"v{i}",
                "mode": "OBSERVE", "actualProfileId": "HIGH", "cohort": "BASELINE"}}
            event["telemetry"]["actual"] = {"executionPath": "taskpool" if i == 0 else "serial_fallback"}
        rows = summary.summarize(data)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["execution_paths"] for row in rows}, {"taskpool", "serial_fallback"})

    def test_injected_background_is_not_reported_as_real_experiment(self):
        data = self.fixture()
        data["events"][2]["deviceState"]["source"] = "MIXED"
        self.assertEqual({row["state_source"] for row in summary.summarize(data)}, {"REAL", "INJECTED_OR_UNKNOWN"})

    def test_missing_background_trace_is_not_reported_as_real(self):
        data = self.fixture()
        data["events"] = data["events"][:2]
        self.assertEqual(summary.summarize(data)[0]["state_source"], "INJECTED_OR_UNKNOWN")

    def test_schema_two_quality_is_opt_in_and_uses_query_ids(self):
        data = self.fixture()
        data["schemaVersion"] = 2
        for trial in data["trials"]:
            trial["queryId"] = "shoes"
            del trial["query"]
        self.assertIsNone(summary.summarize(data, {"shoes": ["a", "c"]})[0]["recall_at_20"])
        data["qualityEvaluationIncluded"] = True
        self.assertEqual(summary.summarize(data, {"shoes": ["a", "c"]})[0]["recall_at_20"], .25)


if __name__ == "__main__":
    unittest.main()
