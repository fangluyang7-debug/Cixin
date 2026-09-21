import appLogicTests from './AppLogic.test';
import localUnitTest from './LocalUnit.test';
import schedulerPresentationTests from './SchedulerPresentation.test';

export default function testsuite() {
  localUnitTest();
  appLogicTests();
  schedulerPresentationTests();
}
