CREATE UNIQUE INDEX IF NOT EXISTS "PhoneDispatchJob_one_inflight_device_idx"
  ON "PhoneDispatchJob"("deviceId")
  WHERE "state" IN ('LEASED', 'STOP_REQUESTED');
