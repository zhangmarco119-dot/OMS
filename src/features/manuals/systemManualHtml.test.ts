import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const files = [
  '门店运营系统_员工与店长使用说明.html',
  '门店运营系统_管理员使用说明.html',
];

describe('standalone system manuals', () => {
  it.each(files)('keeps quick-directory links inside %s', (fileName) => {
    const html = readFileSync(path.join(process.cwd(), 'docs', fileName), 'utf8');
    const targetIds = [...html.matchAll(/<a href="#([^"]+)">/g)].map((match) => match[1]);
    expect(targetIds.length).toBeGreaterThan(0);
    for (const targetId of targetIds) expect(html).toContain(`id="${targetId}"`);
    expect(html).toContain('<base href="about:srcdoc" />');
    expect(html).toContain("document.addEventListener('click'");
    expect(html).toContain("event.target.closest?.('a[href^=\"#\"]')");
    expect(html).toContain('event.preventDefault()');
    expect(html).toContain("target.scrollIntoView({behavior:'auto',block:'start'})");
    expect(html).toContain('html{scroll-behavior:auto}');
    expect(html).not.toContain("onclick=\"location.hash='top'\"");
    expect(html).toContain('.toolbar{position:relative');
    expect(html).toContain('body{line-height:1.62}');
    expect(html).toContain('.manual-section{padding:20px;margin-bottom:12px');
    expect(html).toContain('.page{padding:8px}.hero{padding:20px 16px');
  });
});
