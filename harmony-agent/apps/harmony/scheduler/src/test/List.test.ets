import schedulerUnitTest from './SchedulerUnit.test';
import taskExecutionUnitTest from './TaskExecutionUnit.test';
import semanticSchedulerTest from './SemanticScheduler.test';

export default function testsuite(): void {
  schedulerUnitTest();
  taskExecutionUnitTest();
  semanticSchedulerTest();
}
