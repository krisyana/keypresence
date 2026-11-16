import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { newSiteSecret, signToken } from '../src/server/domain/qr';

describe('QR image round trip (what the phone camera does)', () => {
  it('the URL encoded by the admin QR decodes back exactly with the same decoder the PWA uses', () => {
    const site = { id: '11111111-1111-4111-8111-111111111111', qr_secret: newSiteSecret(), qr_epoch: 1 };
    const url = `http://localhost:5173/s/${signToken('m'.repeat(40), site, '2026-11-16')}`;
    const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size, scale = 6, margin = 4, px = (n + margin * 2) * scale;
    const data = new Uint8ClampedArray(px * px * 4).fill(255);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (!qr.modules.get(x, y)) continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const i = (((y + margin) * scale + dy) * px + (x + margin) * scale + dx) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
    expect(jsQR(data, px, px)?.data).toBe(url);
  });
});
