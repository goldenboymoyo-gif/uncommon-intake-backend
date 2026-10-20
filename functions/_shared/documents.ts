import { extractText, getDocumentProxy } from 'npm:unpdf@0.12.1';
import { unzipSync, strFromU8 } from 'npm:fflate@0.8.2';

// Reads plain text from a PDF or .docx file. Old .doc files are not supported.
export async function documentToText(bytes: Uint8Array, fileName: string): Promise<string> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    return clean(String(text));
  }
  if (lower.endsWith('.docx')) {
    const files = unzipSync(bytes);
    const xml = files['word/document.xml'];
    if (!xml) return '';
    const text = strFromU8(xml)
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
    return clean(text);
  }
  return '';
}

function clean(text: string) {
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 20000);
}
