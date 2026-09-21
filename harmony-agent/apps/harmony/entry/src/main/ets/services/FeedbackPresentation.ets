import { FeedbackAvailability } from 'scheduler';

export function feedbackAvailabilityText(status: FeedbackAvailability): string {
  switch (status.reason) {
    case 'READY': return '可以回答本次体验题';
    case 'CONSENT_REQUIRED': return '体验题未开启：需要你的授权';
    case 'APP_BACKGROUND': return '应用在后台，暂不询问';
    case 'WORKFLOW_NOT_READY': return '等待本次任务完成';
    case 'TASK_NOT_SUCCESSFUL': return '任务未成功，不询问结果体验';
    case 'TASK_TYPE_EXCLUDED': return '后台或实时预览任务不弹体验题';
    case 'RESULT_NOT_DISPLAYED': return '结果未展示或已被忽略';
    case 'PROFILE_REQUIRED': return '该任务没有受控配置，不参与校准';
    case 'ALREADY_ANSWERED': return '本次体验题已回答';
    case 'INVITATION_EXPIRED': return '本次邀请已过期';
    case 'DAILY_LIMIT': return '今日体验题已达到 2 次上限';
    case 'CAPABILITY_DAILY_LIMIT': return '今日已询问过此类任务';
    case 'INTERVAL_LIMIT': return '两次体验题需间隔至少 30 分钟';
    case 'NO_QUESTION_NEEDED': return '暂无需要确认的体验，本次不提问';
    default: return '当前运行时不支持体验题诊断';
  }
}
