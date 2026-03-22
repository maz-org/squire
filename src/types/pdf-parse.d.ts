declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfData {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(buffer: Buffer): Promise<PdfData>;
  export default pdfParse;
}
