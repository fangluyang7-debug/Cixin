import resourceGapTests from './ResourceGapUnit.test';
import executionSafetyUnitTest from './ExecutionSafetyUnit.test';
import schedulerUnitTest from './SchedulerUnit.test';
import taskExecutionUnitTest from './TaskExecutionUnit.test';
import semanticSchedulerTest from './SemanticScheduler.test';

export default function testsuite(): void {
  executionSafetyUnitTest();
  resourceGapTests();
  schedulerUnitTest();
  taskExecutionUnitTest();
  semanticSchedulerTest();
}
