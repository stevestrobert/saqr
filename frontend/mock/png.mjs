// Dependency-free PNG encoder and a procedural "web page" renderer for placeholder screenshots.
import zlib from 'node:zlib';

const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
export function crc32(buf, start = 0, end = buf.length) {
  let c = -1;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode an RGB buffer (3 bytes/pixel) as PNG. */
export function encodePNG(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

class Canvas {
  constructor(w, h, bg = [247, 247, 248]) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    this.rect(0, 0, w, h, bg);
  }
  rect(x, y, w, h, [r, g, b]) {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let o = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.buf[o++] = r;
        this.buf[o++] = g;
        this.buf[o++] = b;
      }
    }
  }
  roundRect(x, y, w, h, color, r = 4) {
    this.rect(x + r, y, w - 2 * r, h, color);
    this.rect(x, y + r, w, h - 2 * r, color);
    this.rect(x + r / 2, y + r / 3, w - r, h - (2 * r) / 3, color);
  }
  frame(x, y, w, h, color, t = 1) {
    this.rect(x, y, w, t, color);
    this.rect(x, y + h - t, w, t, color);
    this.rect(x, y, t, h, color);
    this.rect(x + w - t, y, t, h, color);
  }
  circle(cx, cy, rad, color) {
    for (let yy = -rad; yy <= rad; yy++) {
      const half = Math.sqrt(rad * rad - yy * yy);
      this.rect(cx - half, cy + yy, half * 2, 1, color);
    }
  }
  /** Pseudo-text: rows of short bars with deterministic widths. */
  text(x, y, maxW, lines, color, seed, lineH = 14, barH = 7) {
    let s = seed;
    for (let i = 0; i < lines; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const frac = i === lines - 1 ? 0.45 + ((s >> 8) % 40) / 100 : 0.78 + ((s >> 8) % 22) / 100;
      let cx = x;
      const total = maxW * frac;
      while (cx < x + total - 10) {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        const wordW = 18 + ((s >> 10) % 46);
        this.rect(cx, y + i * lineH, Math.min(wordW, x + total - cx), barH, color);
        cx += wordW + 6;
      }
    }
  }
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const WHITE = [255, 255, 255];
const INK = [38, 42, 48];
const INK2 = [120, 128, 138];
const LINE = [214, 218, 224];
const DARK = [31, 34, 40];

/**
 * Render a government-portal-looking page.
 *  kind: 'fake' (clone with a card form + urgency strip) | 'official' (reference portal, gateway redirect)
 *        | 'benign' (ordinary business site) | 'parked' (registrar parking page) | 'generic'
 */
export function renderPage(opts) {
  const c = renderCanvas(opts);
  return encodePNG(c.w, c.h, c.buf);
}

/** Render at 1280×800 and box-filter down to a crisp 320×200 thumbnail. */
export function renderThumb(opts) {
  const c = renderCanvas({ ...opts, width: 1280, height: 800, mobile: false });
  const { rgb, w, h } = downscale(c.buf, c.w, c.h, 4);
  return encodePNG(w, h, rgb);
}

export function renderCanvas({ width = 1280, height = 800, palette = [200, 16, 46], kind = 'fake', seed = 7, mobile = false }) {
  const c = new Canvas(width, height);
  const W = width;
  const pad = mobile ? 16 : Math.round(W * 0.11);
  const inner = W - pad * 2;
  const header = palette;
  const tint = mix(palette, WHITE, 0.88);

  if (kind === 'parked') {
    c.rect(0, 0, W, height, [240, 241, 244]);
    c.roundRect(pad, height * 0.3, inner, height * 0.32, WHITE, 8);
    c.frame(pad, height * 0.3, inner, height * 0.32, LINE);
    c.text(pad + 40, height * 0.3 + 40, inner - 80, 2, INK2, seed, 22, 12);
    c.text(pad + 40, height * 0.3 + 100, inner - 80, 3, [170, 176, 184], seed + 3);
    c.roundRect(pad + 40, height * 0.3 + 160, 180, 36, [52, 120, 246], 6);
    return c;
  }

  if (kind === 'benign') {
    c.rect(0, 0, W, height, WHITE);
    c.rect(0, 0, W, 64, WHITE);
    c.rect(0, 64, W, 1, LINE);
    c.circle(pad + 18, 32, 14, palette);
    c.text(pad + 44, 27, 120, 1, INK, seed, 12, 10);
    if (!mobile) for (let i = 0; i < 5; i++) c.rect(W - pad - 380 + i * 76, 28, 48, 8, INK2);
    c.rect(0, 65, W, mobile ? 220 : 300, mix(palette, WHITE, 0.82));
    c.text(pad, 65 + (mobile ? 50 : 90), inner * 0.6, 2, INK, seed + 1, mobile ? 26 : 34, mobile ? 14 : 20);
    c.text(pad, 65 + (mobile ? 120 : 180), inner * 0.5, 3, INK2, seed + 2);
    c.roundRect(pad, 65 + (mobile ? 175 : 240), 150, 38, palette, 6);
    const cols = mobile ? 1 : 3;
    const cw = (inner - (cols - 1) * 24) / cols;
    for (let i = 0; i < cols; i++) {
      const x = pad + i * (cw + 24);
      const y = 65 + (mobile ? 250 : 340);
      c.roundRect(x, y, cw, 160, WHITE, 8);
      c.frame(x, y, cw, 160, LINE);
      c.rect(x + 16, y + 16, cw - 32, 60, mix(palette, WHITE, 0.7));
      c.text(x + 16, y + 92, cw - 32, 3, INK2, seed + 10 + i);
    }
    c.rect(0, height - 60, W, 60, [36, 38, 44]);
    return c;
  }

  // government-portal look (official + fake clone share the layout)
  const topBar = mobile ? 0 : 28;
  if (!mobile) {
    c.rect(0, 0, W, topBar, DARK);
    for (let i = 0; i < 4; i++) c.rect(W - pad - 300 + i * 74, 10, 48, 7, [170, 176, 184]);
    c.rect(pad, 10, 90, 7, [170, 176, 184]);
  }
  const hH = mobile ? 60 : 76;
  c.rect(0, topBar, W, hH, header);
  // logo block + wordmark
  c.roundRect(pad, topBar + (hH - 40) / 2, 48, 40, WHITE, 6);
  c.circle(pad + 24, topBar + hH / 2, 9, palette);
  c.rect(pad + 60, topBar + hH / 2 - 11, mobile ? 120 : 170, 10, WHITE);
  c.rect(pad + 60, topBar + hH / 2 + 4, mobile ? 80 : 110, 7, mix(header, WHITE, 0.6));
  if (!mobile) for (let i = 0; i < 5; i++) c.rect(W - pad - 420 + i * 84, topBar + hH / 2 - 4, 56, 8, WHITE);
  else c.rect(W - pad - 28, topBar + 22, 28, 3, WHITE), c.rect(W - pad - 28, topBar + 30, 28, 3, WHITE), c.rect(W - pad - 28, topBar + 38, 28, 3, WHITE);

  let y = topBar + hH;
  // hero band
  const heroH = mobile ? 150 : 170;
  c.rect(0, y, W, heroH, tint);
  c.text(pad, y + (mobile ? 28 : 40), inner * 0.6, 1, INK, seed + 1, 30, mobile ? 14 : 20);
  c.text(pad, y + (mobile ? 70 : 90), inner * 0.5, 2, INK2, seed + 2);
  if (!mobile) {
    c.roundRect(W - pad - 260, y + 36, 260, 98, WHITE, 8);
    c.frame(W - pad - 260, y + 36, 260, 98, LINE);
    c.text(W - pad - 244, y + 56, 228, 3, INK2, seed + 4);
  }
  y += heroH;

  if (kind === 'fake') {
    // urgency strip
    const red = [179, 32, 42];
    c.rect(0, y, W, 34, red);
    c.circle(pad + 12, y + 17, 7, WHITE);
    c.rect(pad + 30, y + 13, mobile ? inner - 60 : 420, 8, WHITE);
    y += 34;
  }
  y += mobile ? 16 : 28;

  // content card
  const cardH = height - y - (mobile ? 90 : 76);
  c.roundRect(pad, y, inner, cardH, WHITE, 10);
  c.frame(pad, y, inner, cardH, LINE);
  const cx = pad + (mobile ? 16 : 32);
  const cw = inner - (mobile ? 32 : 64);
  c.text(cx, y + 26, cw * 0.5, 1, INK, seed + 5, 20, 12);
  c.rect(cx, y + 48, cw, 1, LINE);

  const fieldsFake = mobile ? 5 : 6;
  if (kind === 'fake') {
    // amount box
    c.roundRect(cx, y + 62, mobile ? cw : 240, 54, mix(palette, WHITE, 0.9), 6);
    c.rect(cx + 12, y + 74, 90, 7, INK2);
    c.rect(cx + 12, y + 90, 120, 14, INK);
    // inputs in two columns on desktop
    const cols = mobile ? 1 : 2;
    const fw = (cw - (cols - 1) * 20) / cols;
    const rowH = mobile ? 58 : 66;
    for (let i = 0; i < fieldsFake; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const fx = cx + col * (fw + 20);
      const fy = y + 132 + row * rowH;
      c.rect(fx, fy, 70 + (i % 3) * 22, 7, INK2);
      c.roundRect(fx, fy + 14, fw, 36, WHITE, 5);
      c.frame(fx, fy + 14, fw, 36, [190, 196, 204]);
      if (i === 2) {
        // card brand marks inside the card-number field
        c.roundRect(fx + fw - 92, fy + 22, 36, 20, [26, 31, 113], 3);
        c.roundRect(fx + fw - 50, fy + 22, 36, 20, [235, 0, 27], 3);
        c.circle(fx + fw - 24, fy + 32, 9, [247, 158, 27]);
      }
    }
    const by = y + 132 + Math.ceil(fieldsFake / cols) * rowH + 8;
    c.roundRect(cx, by, mobile ? cw : 220, 42, palette, 6);
    c.rect(cx + 24, by + 17, mobile ? cw - 48 : 150, 8, WHITE);
    c.circle(cx + (mobile ? cw : 220) + 24, by + 21, 8, [52, 168, 83]);
    c.rect(cx + (mobile ? cw : 220) + 40, by + 17, 120, 8, INK2);
  } else {
    // official: lookup form, then a gateway notice (no card fields)
    const cols = mobile ? 1 : 2;
    const fw = (cw - (cols - 1) * 20) / cols;
    for (let i = 0; i < 2; i++) {
      const fx = cx + (i % cols) * (fw + 20);
      const fy = y + 66 + Math.floor(i / cols) * 66;
      c.rect(fx, fy, 90, 7, INK2);
      c.roundRect(fx, fy + 14, fw, 36, WHITE, 5);
      c.frame(fx, fy + 14, fw, 36, [190, 196, 204]);
    }
    const ny = y + 66 + (mobile ? 2 : 1) * 66 + 10;
    c.roundRect(cx, ny, cw, 70, [236, 247, 240], 6);
    c.frame(cx, ny, cw, 70, [176, 222, 196]);
    c.circle(cx + 22, ny + 35, 10, [34, 160, 92]);
    c.text(cx + 44, ny + 20, cw - 60, 2, [60, 110, 80], seed + 7, 16, 8);
    c.roundRect(cx, ny + 90, mobile ? cw : 240, 42, palette, 6);
    c.rect(cx + 24, ny + 107, mobile ? cw - 48 : 170, 8, WHITE);
  }

  // footer
  c.rect(0, height - (mobile ? 70 : 56), W, mobile ? 70 : 56, DARK);
  c.rect(pad, height - (mobile ? 52 : 36), 120, 7, [150, 156, 166]);
  if (!mobile) for (let i = 0; i < 4; i++) c.rect(W - pad - 300 + i * 74, height - 36, 48, 7, [150, 156, 166]);
  return c;
}

/** Box-filter downscale of an RGB buffer by an integer factor. */
export function downscale(rgb, w, h, f) {
  const ow = Math.floor(w / f);
  const oh = Math.floor(h / f);
  const out = Buffer.alloc(ow * oh * 3);
  const n = f * f;
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let dy = 0; dy < f; dy++) {
        let o = ((y * f + dy) * w + x * f) * 3;
        for (let dx = 0; dx < f; dx++) {
          r += rgb[o++];
          g += rgb[o++];
          b += rgb[o++];
        }
      }
      const oo = (y * ow + x) * 3;
      out[oo] = r / n;
      out[oo + 1] = g / n;
      out[oo + 2] = b / n;
    }
  }
  return { rgb: out, w: ow, h: oh };
}
