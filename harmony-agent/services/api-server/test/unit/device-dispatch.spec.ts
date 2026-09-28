import { DeviceDispatchService } from '../../src/core/runtime/device-dispatch.service';
import { RuntimeWorkScope } from '../../src/core/runtime/runtime-work-scope';

describe('device dispatch baseline calibration', () => {
  it('collects actual baseline costs without contacting a worker when no baseline sample exists', async () => {
    const previous = process.env.RUNTIME_DEVICES_JSON;
    process.env.RUNTIME_DEVICES_JSON = JSON.stringify([{deviceId:'pc',endpoint:'http://127.0.0.1:1',tokenEnv:'UNSET_TEST_WORKER_TOKEN',enabled:true,qualityVerified:true,cropPriorMs:1}]);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('MUST_NOT_CONTACT_WORKER'));
    try {
      const service = new DeviceDispatchService();
      const result = {buffer:Buffer.from('actual-baseline'),metadata:{width:1,height:1,format:'jpeg'},cropRegionPx:{left:0,top:0,width:1,height:1},strategy:'test'};
      const local = jest.fn().mockResolvedValue(result);
      const measurements = {storageReadMs:0,storageWriteMs:0,modelMs:0};
      const actual = await RuntimeWorkScope.run(new AbortController().signal, measurements, () => service.crop(Buffer.from('input'),
        {box:{x:0,y:0,width:1,height:1},paddingRatio:0,targetSize:512,jpegQuality:90},local), 'owner', 5000);
      expect(actual).toBe(result);
      expect(local).toHaveBeenCalledTimes(1);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(measurements).toMatchObject({placementDecisions:[{reason:'BASELINE_COST_CALIBRATION',actualDeviceId:'cloud-runtime'}]});
    } finally {
      fetchSpy.mockRestore();
      if(previous === undefined) delete process.env.RUNTIME_DEVICES_JSON; else process.env.RUNTIME_DEVICES_JSON = previous;
    }
  });
});
