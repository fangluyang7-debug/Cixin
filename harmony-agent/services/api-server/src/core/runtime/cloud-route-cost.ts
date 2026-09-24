import { CloudRouteObservation, TaskIntent } from "./runtime.contracts";

export interface CloudRouteEstimate {
  reasons: string[];
  overheadMs: number | null;
  feeMinorUnits: number | null;
}

const MAX_OBSERVATION_AGE_MS = 30_000;
const MIN_SIGNED_URL_REMAINING_MS = 30_000;
const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;

export function estimateCloudRoute(task: TaskIntent, executorId: string,
  now: number = Date.now()): CloudRouteEstimate {
  const route: CloudRouteObservation | undefined = task.cloudRoutes?.find((item) =>
    item.executorId === executorId);
  if (!route) return { reasons: ["CLOUD_ROUTE_PROFILE_MISSING"], overheadMs: null, feeMinorUnits: null };

  const reasons: string[] = [];
  if (!route.transferAuthorized) reasons.push("CLOUD_DATA_TRANSFER_NOT_AUTHORIZED");
  if (route.source !== "measured") reasons.push("CLOUD_ROUTE_NOT_MEASURED");
  const observedAt = Date.parse(route.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now + 5_000 ||
      now - observedAt > MAX_OBSERVATION_AGE_MS) {
    reasons.push("CLOUD_ROUTE_EXPIRED");
  }
  if (route.inputResidence === "cos" && route.accessMode !== "signed_object_url") {
    reasons.push("COS_INPUT_REQUIRES_SIGNED_ACCESS");
  }
  const outputDestination = route.outputDestination ?? "device";
  if (outputDestination !== "device" && route.storageWriteMs === undefined) {
    reasons.push("CLOUD_OUTPUT_WRITE_COST_MISSING");
  }
  const accessExpiresAt = Date.parse(route.accessExpiresAt ?? "");
  if (route.accessMode === "signed_object_url" &&
      (!Number.isFinite(accessExpiresAt) || accessExpiresAt <= now + MIN_SIGNED_URL_REMAINING_MS)) {
    reasons.push("SIGNED_OBJECT_ACCESS_EXPIRED");
  }

  const numbers = [route.inputBytes, route.outputBytes, route.roundTripMs,
    route.uploadMbps, route.downloadMbps, route.storageReadMs, route.queueMs,
    route.storageWriteMs ?? 0];
  if (numbers.some((value) => !Number.isFinite(value) || value < 0) ||
      route.inputBytes > MAX_TRANSFER_BYTES || route.outputBytes > MAX_TRANSFER_BYTES ||
      (route.inputResidence === "device" && route.inputBytes > 0 && route.uploadMbps === 0) ||
      (outputDestination === "device" && route.outputBytes > 0 && route.downloadMbps === 0) ||
      (route.estimatedFeeMinorUnits !== undefined &&
        (!Number.isFinite(route.estimatedFeeMinorUnits) || route.estimatedFeeMinorUnits < 0))) {
    reasons.push("CLOUD_ROUTE_METRICS_INVALID");
  }
  if (reasons.length > 0) return { reasons, overheadMs: null, feeMinorUnits: null };

  // COS and colocated data are read by the cloud executor, not uploaded by the phone.
  const uploadMs = route.inputResidence !== "device" || route.inputBytes === 0
    ? 0 : route.inputBytes * 8 / (route.uploadMbps * 1000);
  const downloadMs = outputDestination !== "device" || route.outputBytes === 0
    ? 0 : route.outputBytes * 8 / (route.downloadMbps * 1000);
  const overheadMs = route.roundTripMs + uploadMs + downloadMs +
    route.storageReadMs + (route.storageWriteMs ?? 0) + route.queueMs;
  if (!Number.isFinite(overheadMs)) {
    return { reasons: ["CLOUD_ROUTE_METRICS_INVALID"], overheadMs: null, feeMinorUnits: null };
  }
  return {
    reasons: [],
    overheadMs,
    feeMinorUnits: route.estimatedFeeMinorUnits ?? null,
  };
}
