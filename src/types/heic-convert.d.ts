declare module "heic-convert" {
  interface ConvertOptions {
    buffer: Uint8Array;
    format: "JPEG" | "PNG";
    quality?: number;
  }
  function heicConvert(options: ConvertOptions): Promise<Uint8Array>;
  export default heicConvert;
}
