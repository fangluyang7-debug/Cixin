import schedulerUnitTest from './SchedulerUnit.test';
import taskExecutionUnitTest from './TaskExecutionUnit.test';
import semanticSchedulerTest from './SemanticScheduler.test';
import constrainedPolicyTest from './ConstrainedPolicy.test';
import executionSafetyUnitTest from './ExecutionSafetyUnit.test';

export default function testsuite(): void {
  schedulerUnitTest();
  taskExecutionUnitTest();
  semanticSchedulerTest();
  constrainedPolicyTest();
  executionSafetyUnitTest();
}
