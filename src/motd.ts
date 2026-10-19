/** 去除 Java 版颜色、样式及扩展 RGB 代码，原样保留正文和换行。 */
export function parseMOTD(description: string): string {
  return description.replace(/§[0-9a-fk-orx]/gi, '');
}
