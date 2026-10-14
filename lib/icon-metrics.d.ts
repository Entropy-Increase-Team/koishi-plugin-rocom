export interface ImageContentBox {
    x: number;
    y: number;
    width: number;
    height: number;
}
export interface ImageMetrics {
    width: number;
    height: number;
    content: ImageContentBox;
}
export interface IconFit {
    scale: number;
    offsetX: number;
    offsetY: number;
}
/** 读一张图的尺寸与内容框；无法识别时返回 null。 */
export declare function readImageMetrics(buffer: Buffer): ImageMetrics | null;
export interface IconFitBox {
    width: number;
    height: number;
    targetArea: number;
}
/**
 * 把「等面积归一」算成 CSS transform 参数。
 * `.goods-img` 本身 object-fit: contain 按整张画布贴边居中，这里再叠一层
 * 以框中心为原点的 translate(...) scale(...)：
 *   - scale 把不透明内容缩放到 targetArea 对应面积，上限是不溢出图标框；
 *   - translate 写在 scale 前，矩阵乘法上位移不会被 scale 再放大，
 *     用于把不在画布中心的内容挪回框中心。
 */
export declare function buildIconFit(metrics: ImageMetrics | null | undefined, options: IconFitBox): IconFit | null;
