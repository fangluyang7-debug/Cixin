import resourceGapTests from './ResourceGapUnit.test';
import schedulerUnitTest from './SchedulerUnit.test';
import taskExecutionUnitTest from './TaskExecutionUnit.test';
import semanticSchedulerTest from './SemanticScheduler.test';
import constrainedPolicyTest from './ConstrainedPolicy.test';
import executionSafetyUnitTest from './ExecutionSafetyUnit.test';
import feedbackCalibrationTests from './FeedbackCalibration.test';

export default function testsuite(): void {
  resourceGapTests();
  schedulerUnitTest();
  taskExecutionUnitTest();
  semanticSchedulerTest();
  constrainedPolicyTest();
  executionSafetyUnitTest();
  feedbackCalibrationTests();
}
