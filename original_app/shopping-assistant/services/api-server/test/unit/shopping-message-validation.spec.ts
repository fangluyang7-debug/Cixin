import { PayloadTooLargeException } from '@nestjs/common';
import {
  SHOPPING_MESSAGE_MAX_CODE_POINTS,
  validateShoppingMessage,
} from '../../src/common/shopping/shopping-message-validation';

describe('shopping message validation', () => {
  const options = {
    requiredCode: 'MESSAGE_REQUIRED',
    tooLongCode: 'MESSAGE_TOO_LONG',
  };

  it.each([
    SHOPPING_MESSAGE_MAX_CODE_POINTS - 1,
    SHOPPING_MESSAGE_MAX_CODE_POINTS,
  ])('accepts %i code points', (length) => {
    expect(validateShoppingMessage('a'.repeat(length), options)).toHaveLength(length);
  });

  it('rejects max + 1 before downstream processing', () => {
    expect(() =>
      validateShoppingMessage('a'.repeat(SHOPPING_MESSAGE_MAX_CODE_POINTS + 1), options),
    ).toThrow(PayloadTooLargeException);
  });

  it('also enforces the UTF-8 byte boundary', () => {
    expect(() => validateShoppingMessage('购'.repeat(2000), options)).not.toThrow();
    expect(() => validateShoppingMessage('😀'.repeat(2000), options)).not.toThrow();
    expect(() => validateShoppingMessage('😀'.repeat(2049), options)).toThrow(
      PayloadTooLargeException,
    );
  });
});
