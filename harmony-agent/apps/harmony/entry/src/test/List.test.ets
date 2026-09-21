import appLogicTests from './AppLogic.test';
import localUnitTest from './LocalUnit.test';

export default function testsuite() {
  localUnitTest();
  appLogicTests();
}