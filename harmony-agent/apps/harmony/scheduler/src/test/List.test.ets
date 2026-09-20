import schedulerUnitTest from './SchedulerUnit.test';
import taskExecutionUnitTest from './TaskExecutionUnit.test';
import executionSafetyUnitTest from './ExecutionSafetyUnit.test';

export default function testsuite(): void {
  schedulerUnitTest();
  taskExecutionUnitTest();
  executionSafetyUnitTest();
}
