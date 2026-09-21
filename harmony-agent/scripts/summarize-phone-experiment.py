"""Summarize exported phone experiments without treating estimates as measurements."""
import argparse
import csv
import json
import math
from collections import defaultdict
from pathlib import Path


def percentile(values, percent):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * percent) - 1)] if ordered else None


def summarize(document, labels=None):
    if document.get("schemaVersion") not in (1, 2) or not isinstance(document.get("trials"), list):
        raise ValueError("Unsupported or missing experiment schema")
    if document.get("droppedEvents", 0):
        raise ValueError("Audit capture overflowed; this experiment is incomplete")
    labels = labels or {}
    events = document.get("events", [])
    terminal = {"SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"}
    groups = defaultdict(list)
    for trial in document["trials"]:
        related = [e for e in events if e.get("taskId", "").startswith(trial["workflowId"] + ":")]
        background_id = trial.get("backgroundWorkflowId")
        background_events = [e for e in events if background_id and
                             e.get("taskId", "").startswith(background_id + ":")]
        scoped = related + background_events
        # Background pressure is part of the experiment; its injected state cannot be hidden.
        sources = {e.get("deviceState", {}).get("source", "UNKNOWN") for e in scoped}
        complete_trace = bool(related) and (not trial["background"] or bool(background_events))
        source = "REAL" if complete_trace and sources == {"REAL"} else "INJECTED_OR_UNKNOWN"
        profiles = set()
        paths = set()
        for event in scoped:
            if event.get("status") in {"CREATED", "QUEUED"} or event.get("startedAt", 0) is None:
                continue
            plan = event.get("executionPlan", {})
            audit = plan.get("policyAudit", {})
            if audit:
                profiles.add((audit.get("contractId", "UNKNOWN"), audit.get("version", "UNKNOWN"),
                              audit.get("mode", "UNKNOWN"), audit.get("actualProfileId", "UNKNOWN"),
                              audit.get("cohort", "UNKNOWN")))
            actual = event.get("telemetry", {}).get("actual", {})
            if actual.get("executionPath"):
                paths.add(actual["executionPath"])
        signature = json.dumps(sorted(profiles), ensure_ascii=False, separators=(",", ":")) if profiles else "LEGACY_OR_UNOBSERVED"
        path_signature = "|".join(sorted(paths)) or "UNOBSERVED"
        groups[(trial["mode"], trial["background"], trial["samplePhase"], source,
                signature, path_signature)].append((trial, related))
    summaries = []
    for (mode, background, phase, source, signature, path_signature), samples in sorted(groups.items()):
        all_times = [t["durationMs"] for t, _ in samples]
        successful_times = [t["durationMs"] for t, _ in samples if t["status"] == "SUCCEEDED"]
        queues, recalls, precisions, background_rates = [], [], [], []
        deadline_misses = 0
        for trial, related in samples:
            finals = [e for e in related if e.get("status") in terminal]
            queues.append(sum(e.get("queueDurationMs") or 0 for e in finals))
            deadline_misses += int(any(e.get("telemetry", {}).get("deadlineMissed", False) or
                                       e.get("errorCode") == "DEADLINE_EXCEEDED" for e in finals))
            truth = set(labels.get(trial.get("queryId", trial.get("query")), []))
            quality_included = document.get("qualityEvaluationIncluded", document["schemaVersion"] == 1)
            if truth and quality_included and isinstance(trial.get("productIds"), list):
                retrieved = set(trial["productIds"][:20]) if trial["status"] == "SUCCEEDED" else set()
                hits = len(truth & retrieved)
                recalls.append(hits / len(truth))
                precisions.append(hits / len(retrieved) if retrieved else 0.0)
            duration = trial.get("backgroundDurationMs")
            if trial.get("backgroundStatus") == "SUCCEEDED" and duration and duration > 0:
                background_rates.append(trial["backgroundRows"] * 1000 / duration)
        count = len(samples)
        summaries.append(dict(mode=mode, background=background, sample_phase=phase, state_source=source,
            comparison_scope=document.get("comparisonScope", "LEGACY_POLICY_MODE"),
            policy_profile_signature=signature, execution_paths=path_signature,
            samples=count, successes=len(successful_times), success_rate=len(successful_times) / count,
            all_outcomes_p50_ms=percentile(all_times, .5), all_outcomes_p95_ms=percentile(all_times, .95),
            success_p50_ms=percentile(successful_times, .5), success_p95_ms=percentile(successful_times, .95),
            average_node_queue_ms=sum(queues) / count, deadline_miss_rate=deadline_misses / count,
            background_successes=len(background_rates),
            background_rows_per_second=sum(background_rates) / len(background_rates) if background_rates else None,
            labeled_samples=len(recalls), recall_at_20=sum(recalls) / len(recalls) if recalls else None,
            precision_among_returned_top20=sum(precisions) / len(precisions) if precisions else None))
    return summaries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--labels", type=Path, help="Independent queryId -> relevant externalId list JSON (v1 query keys also accepted)")
    parser.add_argument("--output", type=Path, default=Path("phone-summary.csv"))
    args = parser.parse_args()
    document = json.loads(args.input.read_text(encoding="utf-8-sig"))
    labels = json.loads(args.labels.read_text(encoding="utf-8-sig")) if args.labels else {}
    rows = summarize(document, labels)
    if not rows:
        raise ValueError("No completed trial records; inspect the raw error/cancelled fields")
    with args.output.open("w", encoding="utf-8-sig", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} groups to {args.output}; power/energy are not measured.")
    if document.get("schemaVersion") == 2:
        print("NOTE: Mode labels are legacy policy settings, not constrained-profile treatments; inspect policy_profile_signature.")
    if document.get("cancelled") or document.get("error"):
        print("WARNING: Session was interrupted; only recorded trials are summarized.")


if __name__ == "__main__":
    main()
