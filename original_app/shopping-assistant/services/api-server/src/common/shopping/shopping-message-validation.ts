import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';

export const SHOPPING_MESSAGE_MAX_CODE_POINTS = 2000;
export const SHOPPING_MESSAGE_MAX_UTF8_BYTES = 8192;

export function validateShoppingMessage(
  value: unknown,
  options: {
    requiredCode: string;
    tooLongCode: string;
  },
) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(options.requiredCode);
  }
  const codePoints = [...value].length;
  const utf8Bytes = Buffer.byteLength(value, 'utf8');
  if (
    codePoints > SHOPPING_MESSAGE_MAX_CODE_POINTS ||
    utf8Bytes > SHOPPING_MESSAGE_MAX_UTF8_BYTES
  ) {
    throw new PayloadTooLargeException({
      code: options.tooLongCode,
      message: `消息不能超过 ${SHOPPING_MESSAGE_MAX_CODE_POINTS} 个字符或 ${SHOPPING_MESSAGE_MAX_UTF8_BYTES} 字节。`,
      codePoints,
      utf8Bytes,
    });
  }
  return value.trim();
}
