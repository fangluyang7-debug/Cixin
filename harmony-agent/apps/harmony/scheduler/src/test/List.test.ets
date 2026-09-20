import schedulerUnitTest from './SchedulerUnit.test';
import taskExecutionUnitTest from './TaskExecutionUnit.test';

export default function testsuite(): void {
  schedulerUnitTest();
  taskExecutionUnitTest();
}
