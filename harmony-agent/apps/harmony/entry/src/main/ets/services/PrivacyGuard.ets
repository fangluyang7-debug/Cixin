import { DataResidencyPolicy, DataSensitivity, PrivacyContext } from 'scheduler';

export interface PrivacyAssessment {
  context: PrivacyContext;
  matchedCategory: string;
}

export class PrivacyGuard {
  private static readonly sensitiveMarkers: string[] = [
    '身份证', '手机号', '电话号码', '联系电话', '银行卡', '信用卡',
    '密码', '验证码', '订单号', '收货地址', '家庭住址', '联系人',
    '我的位置', '病历', '诊断', '收入', '工资'
  ];

  public static assessText(text: string): PrivacyAssessment {
    const normalized: string = text.trim().toLowerCase();
    for (let index: number = 0; index < PrivacyGuard.sensitiveMarkers.length; index++) {
      const marker: string = PrivacyGuard.sensitiveMarkers[index];
      if (normalized.indexOf(marker) >= 0) {
        return PrivacyGuard.localOnly(`检测到个人敏感字段：${marker}`, marker);
      }
    }

    if (PrivacyGuard.hasLongDigitSequence(normalized)) {
      return PrivacyGuard.localOnly('检测到可能的手机号、证件号或订单号', 'long_digit_sequence');
    }

    return {
      context: {
        sensitivity: DataSensitivity.PUBLIC,
        residencyPolicy: DataResidencyPolicy.CLOUD_ALLOWED,
        cloudConsent: true,
        reason: '未检测到个人敏感字段，仅发送购物意图与结构化商品候选'
      },
      matchedCategory: 'none'
    };
  }

  public static assertCloudAllowed(text: string): PrivacyContext {
    const assessment: PrivacyAssessment = PrivacyGuard.assessText(text);
    if (assessment.context.residencyPolicy === DataResidencyPolicy.LOCAL_ONLY ||
      !assessment.context.cloudConsent) {
      throw new Error(`PRIVACY_POLICY_VIOLATION: ${assessment.context.reason}`);
    }
    return assessment.context;
  }

  private static localOnly(reason: string, category: string): PrivacyAssessment {
    return {
      context: {
        sensitivity: DataSensitivity.SENSITIVE,
        residencyPolicy: DataResidencyPolicy.LOCAL_ONLY,
        cloudConsent: false,
        reason: reason
      },
      matchedCategory: category
    };
  }

  private static hasLongDigitSequence(text: string): boolean {
    let consecutiveDigits: number = 0;
    for (let index: number = 0; index < text.length; index++) {
      const code: number = text.charCodeAt(index);
      if (code >= 48 && code <= 57) {
        consecutiveDigits++;
        if (consecutiveDigits >= 8) {
          return true;
        }
      } else {
        consecutiveDigits = 0;
      }
    }
    return false;
  }
}
