import { FeedbackRequest, FeedbackOption } from 'scheduler';
import { feedbackQuestion, feedbackLabel } from '../services/CommercePresentation';
import { CommerceIconButton } from './CommerceControls';

@Component
export struct ExperienceFeedback {
  @Prop request: FeedbackRequest;
  @Prop submitting: boolean = false;
  @Prop maxRise: number = 120;
  onAnswer: (option: FeedbackOption) => void = () => {};
  onDismiss: () => void = () => {};
  @State offsetY: number = 0;
  private startY: number = 0;
  build() {
    Column({ space: 10 }) {
      Row({ space: 8 }) {
        Image($r('sys.media.ohos_ic_public_drawer_open')).width(18).height(18).fillColor('#009576')
        Text('搜索体验反馈').fontSize(13).fontWeight(FontWeight.Bold).layoutWeight(1)
        CommerceIconButton({ icon: $r('sys.media.ohos_ic_public_close'), label: '稍后反馈', action: this.onDismiss })
      }.width('100%').gesture(PanGesture().onActionStart(() => { this.startY = this.offsetY; })
        .onActionUpdate((event: GestureEvent) => { this.offsetY = Math.max(-Math.max(0, this.maxRise), Math.min(0, this.startY + event.offsetY)); }))
      Divider().color('#EEEEEE')
      Text(feedbackQuestion(this.request.kind)).fontSize(14).width('100%')
      Flex({ wrap: FlexWrap.Wrap, justifyContent: FlexAlign.SpaceBetween }) {
        ForEach(this.request.options, (option: FeedbackOption) => {
          Button(feedbackLabel(option)).width('48%').height(36).fontSize(12).fontColor('#1A1C1C')
            .backgroundColor('#F3F3F3').margin({ bottom: 6 }).enabled(!this.submitting).onClick(() => this.onAnswer(option))
        })
      }.width('100%')
    }.padding(14).width('100%').backgroundColor('#FFFFFF').borderRadius(8)
      .border({ width: 1, color: '#E2E2E2' }).shadow({ radius: 16, color: '#20000000', offsetY: 4 })
      .translate({ y: Math.max(-Math.max(0, this.maxRise), this.offsetY) })
  }
}
