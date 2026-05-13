import { marked } from 'marked';
import DOMPurify from 'dompurify';

/**
 * Markdown -> sanitized HTML for plugin READMEs. Strips all tags and URIs that
 * could phone home or execute code; only in-document anchor links survive.
 * README content ships alongside untrusted plugin code, so we treat it as
 * untrusted content even though it is text.
 */
export function renderReadme(markdown: string): string {
  const rawHtml = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
  return DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: ['img', 'iframe', 'video', 'audio', 'object', 'embed', 'svg', 'script', 'style', 'form'],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
    ALLOWED_URI_REGEXP: /^#/,
  });
}
