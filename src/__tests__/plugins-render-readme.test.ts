import { describe, it, expect } from 'vitest';
import { renderReadme } from '../plugins/ui/renderReadme';

describe('renderReadme', () => {
  it('renders headings, paragraphs, and code blocks', () => {
    const html = renderReadme('# Title\n\nA paragraph.\n\n```\ncode\n```\n');
    expect(html).toMatch(/<h1[^>]*>Title<\/h1>/);
    expect(html).toMatch(/<p>A paragraph\.<\/p>/);
    expect(html).toMatch(/<pre><code>code\n<\/code><\/pre>/);
  });

  it('strips <img> tags entirely', () => {
    const html = renderReadme('![alt](http://example.com/x.png)');
    expect(html).not.toMatch(/<img/);
  });

  it('strips href on external anchors but keeps text', () => {
    const html = renderReadme('[click](http://evil.example.com)');
    expect(html).toMatch(/click/);
    expect(html).not.toMatch(/http:\/\/evil/);
  });

  it('preserves anchor links to in-document fragments', () => {
    const html = renderReadme('[section](#section)');
    expect(html).toMatch(/href="#section"/);
  });

  it('strips <script> tags', () => {
    const html = renderReadme('Text <script>alert(1)</script> more');
    expect(html).not.toMatch(/<script/);
    expect(html).toMatch(/Text/);
    expect(html).toMatch(/more/);
  });

  it('strips javascript: URIs from anchors', () => {
    const html = renderReadme('[x](javascript:alert(1))');
    expect(html).not.toMatch(/javascript:/);
  });

  it('strips <style> tags', () => {
    const html = renderReadme('text\n\n<style>body{display:none}</style>');
    expect(html).not.toMatch(/<style/);
  });

  it('strips inline event handlers and style attributes', () => {
    const html = renderReadme('<a href="#x" onclick="alert(1)" style="color:red">link</a>');
    expect(html).not.toMatch(/onclick/);
    expect(html).not.toMatch(/style=/);
  });
});
