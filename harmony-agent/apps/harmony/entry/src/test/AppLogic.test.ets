import { describe, expect, it } from '@ohos/hypium';
import { parseSearchConstraints, matchesSearchConstraints } from '../main/ets/services/SearchConstraints';
import { NormalizationProgress, validateNormalizationProgress, appendNormalizationValues } from '../main/ets/services/NormalizationCheckpoint';
import { collectVectorPartitions } from '../main/ets/services/VectorPartitionResults';
import { ExperimentTrial, exportTrialRecords } from '../main/ets/services/ExperimentRecords';
import { numericPrice, productKey, safeProductUrl, feedbackQuestion, feedbackLabel, feedbackReceiptText } from '../main/ets/services/CommercePresentation';
import { Product } from '../main/ets/models/Product';
import { ConstrainedPolicyMode, FeedbackKind, FeedbackOption } from 'scheduler';

function trialFixture(): ExperimentTrial {
  return { mode: 'ADAPTIVE', background: false, repetition: 0, queryId: 'shoes', startedAt: 1,
    durationMs: 10, status: 'SUCCEEDED', workflowId: 'test', backgroundWorkflowId: null,
    constrainedPolicyVersion: 'local-v1', constrainedPolicyMode: 'OBSERVE', productIds: ['public-product-id'],
    backgroundDurationMs: null, backgroundStatus: 'not_requested', backgroundRows: 0, samplePhase: 'test' };
}

export default function appLogicTests(): void {
  describe('RealWorkloadPureLogic', () => {
    it('commerceLinksRejectExecutableSchemesAndMalformedHosts', 0, () => {
      expect(safeProductUrl('https://item.jd.com/123.html')).assertTrue();
      expect(safeProductUrl('javascript:alert(1)')).assertFalse();
      expect(safeProductUrl('http://example.com')).assertFalse();
      expect(safeProductUrl('https://good.com@bad.com')).assertFalse();
      expect(safeProductUrl('https://bad.com/has space')).assertFalse();
    });
    it('commercePriceSortingDoesNotInventUnknownPrices', 0, () => {
      const item = new Product('p1', 'jd', 'shoe', '￥1,000', 'CNY', '', '', '', '', '');
      expect(numericPrice(item)).assertEqual(1000);
      item.price = '200-600'; expect(numericPrice(item)).assertEqual(Infinity);
      item.price = '面议'; expect(numericPrice(item)).assertEqual(Infinity);
    });
    it('savedProductIdentityIncludesPlatform', 0, () => {
      const item = new Product('p1', 'jd', 'shoe', '100', 'CNY', '', '', '', '', '');
      expect(productKey(item)).assertEqual('jd:p1');
      item.platform = 'tb'; expect(productKey(item)).assertEqual('tb:p1');
    });
    it('rejectedFeedbackDoesNotClaimOptimization', 0, () => {
      expect(feedbackReceiptText({ accepted: false, taskRunId: 'a', effect: 'REJECTED', reason: 'expired' }).indexOf('未接收') >= 0).assertTrue();
    });
    it('experienceQuestionsAskOnlyAboutSubjectiveToleranceAndResultNeeds', 0, () => {
      expect(feedbackQuestion(FeedbackKind.RESPONSE_TIME).indexOf('目标') < 0).assertTrue();
      expect(feedbackQuestion(FeedbackKind.RESPONSE_TIME).indexOf('接受') >= 0).assertTrue();
      expect(feedbackQuestion(FeedbackKind.RESULT_UTILITY).indexOf('需求') >= 0).assertTrue();
      expect(feedbackLabel(FeedbackOption.SLOW)).assertEqual('有点慢');
    });
    it('feedbackReceiptUsesPlainLanguageWithoutExecutionClaims', 0, () => {
      const text = feedbackReceiptText({ accepted: true, taskRunId: 'a', effect: 'CALIBRATED', reason: 'bounded',
        mode: ConstrainedPolicyMode.SHADOW, after: { speedSamples: 2, qualitySamples: 0, profileSamples: 2,
        latencyWeight: 10, qualityWeight: 3, profilePenalty: 3 } });
      expect(text.indexOf('安全边界') >= 0).assertTrue();
      expect(text.indexOf('10.0') < 0).assertTrue();
    });
    it('omitsQualityResultsFromDefaultExperimentExport', 0, () => {
      const result = exportTrialRecords([trialFixture()]);
      const raw = JSON.stringify(result);
      expect(raw.indexOf('public-product-id') < 0).assertTrue();
      expect(raw.indexOf('productIds') < 0).assertTrue();
      expect(result[0].queryId).assertEqual('shoes');
    });
    it('exportsDetachedQualityIdsOnlyWhenExplicitlyEnabled', 0, () => {
      const trial = trialFixture();
      const result = exportTrialRecords([trial], true);
      expect(result[0].productIds![0]).assertEqual('public-product-id');
      result[0].productIds![0] = 'changed';
      expect(trial.productIds![0]).assertEqual('public-product-id');
    });
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
