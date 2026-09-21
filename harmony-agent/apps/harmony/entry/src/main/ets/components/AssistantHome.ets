import { Product } from '../models/Product';
import { ProductTile } from './CommerceControls';
import { productKey } from '../services/CommercePresentation';

@Component
export struct AssistantHome {
  @Prop products: Product[] = [];
  @Prop savedKeys: string[] = [];
  @Prop status: string = '';
  onSearch: (query: string) => void = () => {};
  onFill: (query: string) => void = () => {};
  onPhoto: () => void = () => {};
  onOpen: (product: Product) => void = () => {};
  onSave: (product: Product) => void = () => {};

  @Builder
  private Shortcut(title: string, subtitle: string, icon: Resource, query: string) {
    Button({ type: ButtonType.Normal }) {
      Row({ space: 8 }) {
        Image(icon).width(23).height(23).fillColor('#1A1C1C')
        Column({ space: 3 }) {
          Text(title).fontSize(14).fontWeight(FontWeight.Bold).fontColor('#1A1C1C').maxLines(1)
          Text(subtitle).fontSize(11).fontColor('#747878').maxLines(1)
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
      }.width('100%')
    }.width('48%').height(72).padding(12).borderRadius(8).backgroundColor('#FFFFFF')
      .onClick(() => { if (query === '') { this.onPhoto(); } else { this.onSearch(query); } })
  }

  build() {
    Column({ space: 20 }) {
      Column({ space: 12 }) {
        Button({ type: ButtonType.Circle }) {
          Image($r('sys.media.ohos_ic_public_camera')).width(34).height(34)
        }.width(78).height(78).backgroundColor('#FFFFFF').border({ width: 6, color: '#EEEEEE' })
          .accessibilityText('选择商品图片').onClick(this.onPhoto)
        Text('今天想找什么？').fontSize(26).fontWeight(FontWeight.Bold).textAlign(TextAlign.Center).width('100%')
        Text('说出预算、品牌、场景').fontSize(14).fontColor('#444748')
        Text(this.status).fontSize(11).fontColor('#747878').textAlign(TextAlign.Center).width('100%')
      }.width('100%').padding({ top: 18, bottom: 4 })
      Row() {
        this.Shortcut('选图找商品', '图片预览', $r('sys.media.ohos_ic_public_camera'), '')
        Blank()
        this.Shortcut('男生通勤鞋', '百搭轻便款', $r('sys.media.ohos_ic_public_express'), '男鞋 通勤')
      }.width('100%')
      Row() {
        this.Shortcut('500以内跑鞋', '预算内精选', $r('sys.media.ohos_ic_public_search_filled'), '跑鞋 500元以内')
        Blank()
        this.Shortcut('耐克运动鞋', '品牌商品', $r('sys.media.ohos_ic_public_scan'), '耐克 运动鞋')
      }.width('100%')
      Row({ space: 10 }) {
        Column({ space: 6 }) {
          Text('试试这样问').fontSize(11).fontColor('#747878')
          Text('有什么适合男生通勤穿的鞋？').fontSize(14).fontColor('#1A1C1C')
        }.layoutWeight(1).alignItems(HorizontalAlign.Start)
        Button('填入').height(34).fontSize(12).backgroundColor('#FFFFFF').fontColor('#1A1C1C')
          .onClick(() => this.onFill('有什么适合男生通勤穿的鞋？'))
      }.padding(14).width('100%').backgroundColor('#EEEEEE')
      Text('本地商品精选').fontSize(16).fontWeight(FontWeight.Bold).width('100%')
      Scroll() {
        Row({ space: 12 }) {
          ForEach(this.products, (product: Product) => {
            Column() {
              ProductTile({ product: product, saved: this.savedKeys.indexOf(productKey(product)) >= 0,
                onOpen: this.onOpen, onSave: this.onSave })
            }.width(156)
          }, productKey)
        }
      }.scrollable(ScrollDirection.Horizontal).scrollBar(BarState.Off).width('100%')
    }.width('100%').alignItems(HorizontalAlign.Start)
  }
}
