import { describe, expect, it } from '@ohos/hypium';
import { parseSearchConstraints, matchesSearchConstraints } from '../main/ets/services/SearchConstraints';
import { NormalizationProgress, validateNormalizationProgress, appendNormalizationValues } from '../main/ets/services/NormalizationCheckpoint';
import { collectVectorPartitions } from '../main/ets/services/VectorPartitionResults';

export default function appLogicTests(): void {
  describe('RealWorkloadPureLogic', () => {
    it('enforcesBrandAndUpperPriceTogether', 0, () => {
      const c = parseSearchConstraints('耐克500元以内');
      expect(matchesSearchConstraints('NIKE 运动鞋', '499', c)).assertTrue();
      expect(matchesSearchConstraints('耐克鞋', '501', c)).assertFalse();
      expect(matchesSearchConstraints('其他品牌鞋', '299', c)).assertFalse();
    });
    it('honorsBothBoundsAndIncludesBoundaryPrices', 0, () => {
      const c = parseSearchConstraints('华为1000到2000元');
      expect(matchesSearchConstraints('HUAWEI', '￥1,000', c)).assertTrue();
      expect(matchesSearchConstraints('华为', '2000', c)).assertTrue();
      expect(matchesSearchConstraints('华为', '999', c)).assertFalse();
    });
    it('doesNotAcceptUnknownOrRangePricesForHardConstraints', 0, () => {
      const c = parseSearchConstraints('预算500');
      expect(matchesSearchConstraints('鞋', '面议', c)).assertFalse();
      expect(matchesSearchConstraints('鞋', '200-600', c)).assertFalse();
    });
    it('unconstrainedSearchDoesNotDropUnknownPrices', 0, () => {
      expect(matchesSearchConstraints('运动鞋', '面议', parseSearchConstraints('运动鞋'))).assertTrue();
    });
    it('rejectsInconsistentCheckpointWithoutChangingIt', 0, () => {
      const progress: NormalizationProgress = { cursor: 2, dimension: 256, modelVersion: 'v1', norms: [1] };
      let rejected: boolean = false;
      try { validateNormalizationProgress(progress, 'v1', 256, 10); } catch (error) { rejected = true; }
      expect(rejected).assertTrue(); expect(progress.cursor).assertEqual(2);
    });
    it('rejectsOldModelCheckpoint', 0, () => {
      const progress: NormalizationProgress = { cursor: 0, dimension: 256, modelVersion: 'old', norms: [] };
      let rejected: boolean = false;
      try { validateNormalizationProgress(progress, 'new', 256, 10); } catch (error) { rejected = true; }
      expect(rejected).assertTrue();
    });
    it('appendsOnlyCompleteValidChunks', 0, () => {
      const progress: NormalizationProgress = { cursor: 1, dimension: 256, modelVersion: 'v1', norms: [2] };
      let rejected: boolean = false;
      try { appendNormalizationValues(progress, [3, NaN], 3); } catch (error) { rejected = true; }
      expect(rejected).assertTrue(); expect(progress.norms.length).assertEqual(1);
      appendNormalizationValues(progress, [3, 4], 3);
      expect(progress.cursor).assertEqual(3); expect(progress.norms[0]).assertEqual(2);
    });
    it('waitsForOtherWorkersBeforeAllowingFallback', 0, async () => {
      let settled: boolean = false;
      const delayed = new Promise<Object>((resolve) => setTimeout(() => { settled = true; resolve([1]); }, 10));
      let failed: boolean = false;
      try { await collectVectorPartitions([Promise.reject(new Error('worker failure')), delayed]); }
      catch (error) { failed = true; }
      expect(failed).assertTrue(); expect(settled).assertTrue();
    });
    it('preservesAllSuccessfulPartitionScores', 0, async () => {
      const values = await collectVectorPartitions([Promise.resolve([0.2, 0.3]), Promise.resolve([0.9])]);
      expect(values.length).assertEqual(2); expect(values[1][0]).assertEqual(0.9);
    });
  });
}
