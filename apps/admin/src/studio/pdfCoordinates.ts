export interface PdfViewportLike {
  convertToViewportPoint(x: number, y: number): number[];
}

export function viewportPoint(
  viewport: PdfViewportLike,
  x: number,
  y: number,
): [number, number] {
  const value = viewport.convertToViewportPoint(x, y);
  return [Number(value[0] ?? 0), Number(value[1] ?? 0)];
}
