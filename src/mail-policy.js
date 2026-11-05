export const MAIL_CATEGORIES = {
  notification: '通知邮件', meeting: '会议邀请', transaction: '账单与交易',
  security: '账号与安全', promotion: '推广与订阅', conversation: '沟通与工作请求', other: '其他邮件',
};
export const REPLY_REASONS = ['none', 'explicit_request', 'coordination', 'appeal_dispute', 'missing_information'];

export const CLASSIFICATION_RULE = `先按邮件实际用途分类：
notification 通知邮件：系统通知、状态更新、物流进度、处理结果。
meeting 会议邀请：日历邀请、会议提醒、时间或地点变更。
transaction 账单与交易：账单、收据、付款成功、订单确认。
security 账号与安全：验证码、登录提醒、密码或账号变更。
promotion 推广与订阅：营销、新闻简报、订阅资讯。
conversation 沟通与工作请求：个人往来、业务问题、需要用户提供信息或作决定的请求。
other 其他邮件：无法确定用途时使用，不能因此默认建议回复。
分类和是否回复分别判断。上述常规通知、会议邀请、账单、安全、推广邮件默认 needsReply=false。
只需知悉、查看、付款、进入官网处理或在日历接受/拒绝邀请，不等于需要邮件回复。
仅当原文明确要求邮件答复（explicit_request）、确实需要协商时间或事项（coordination）、
有具体争议/错误/拒绝结果且确有申诉或异议必要（appeal_dispute）、或必须询问缺失信息才能推进（missing_information），才可 needsReply=true。
回复建议必须给出 replyEvidence：邮件中支持该需要的简短事实或原文片段，不能编造争议、替用户表达不满或泛泛建议申诉。
没有充分依据时 replyReason=none、replyEvidence=""、needsReply=false。不确定用户是否有异议时，不推荐回复。
请勿把自动发件人或 no-reply 地址当作可回复渠道；有申诉需要但只能通过官网/客服渠道时，列出该处理待办，needsReply=false。
needsReply=false 时 actions 不得推荐拟邮件回复，但保留实际待办（如日历确认、查看账单）。
任何分类都不自动生成回复草稿，只有用户明确要求后才拟稿。`;

export function replyRecommended(summary) {
  return summary.needsReply === true && summary.replyReason !== 'none'
    && REPLY_REASONS.includes(summary.replyReason)
    && typeof summary.replyEvidence === 'string' && !!summary.replyEvidence.trim();
}
