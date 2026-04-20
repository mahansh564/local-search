/**
 * Rotating 3D torus as ANSI Braille — tuned for a cleaner, more “modern” look:
 * Z then X rotation, softer multi-stop gradient, rim + key lighting, gamma.
 */

const SHADOW = { r: 0x42, g: 0x42, b: 0x62 };
const MID = { r: 0x6e, g: 0xc4, b: 0xb8 };
const PEARL = { r: 0x99, g: 0xe1, b: 0xd9 };
const ACCENT = { r: 0xf7, g: 0x56, b: 0x7c };
const HIGHLIGHT = { r: 0xff, g: 0xfa, b: 0xe3 };

const BRAILLE_BASE = 0x2800;

function brailleBit(dx: number, dy: number): number {
  const table = [
    [0x01, 0x08],
    [0x02, 0x10],
    [0x04, 0x20],
    [0x40, 0x80],
  ];
  return table[dy]![dx]!;
}

function fgAnsi(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

const RESET = "\x1b[0m";

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0 || 1)));
  return t * t * (3 - 2 * t);
}

function lerpColor(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number): { r: number; g: number; b: number } {
  const u = Math.min(1, Math.max(0, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * u),
    g: Math.round(a.g + (b.g - a.g) * u),
    b: Math.round(a.b + (b.b - a.b) * u),
  };
}

/** Multi-stop gradient + slight gamma for smoother halftone. */
function colorForShade(s: number): string {
  const g = Math.pow(Math.min(1, Math.max(0, s)), 0.92);
  let rgb: { r: number; g: number; b: number };
  if (g < 0.35) {
    rgb = lerpColor(SHADOW, MID, smoothstep(0, 0.35, g) / 0.35);
  } else if (g < 0.62) {
    rgb = lerpColor(MID, PEARL, smoothstep(0.35, 0.62, g));
  } else if (g < 0.88) {
    rgb = lerpColor(PEARL, ACCENT, smoothstep(0.62, 0.88, g));
  } else {
    rgb = lerpColor(ACCENT, HIGHLIGHT, smoothstep(0.88, 1, g));
  }
  return fgAnsi(rgb.r, rgb.g, rgb.b);
}

/**
 * @param width terminal columns for the art region
 * @param height terminal rows for the art region
 * @param frame animation tick
 */
export function renderTorusFrame(width: number, height: number, frame: number): string[] {
  if (width < 4 || height < 2) {
    return Array.from({ length: Math.max(1, height) }, () => " ".repeat(Math.max(1, width)));
  }

  const subW = width * 2;
  const subH = height * 4;
  const zbuf = new Float32Array(subW * subH);
  const shade = new Float32Array(subW * subH);
  zbuf.fill(0);

  const R1 = 1;
  const R2 = 2;
  const A = frame * 0.035;
  const B = frame * 0.022;
  const cosA = Math.cos(A);
  const sinA = Math.sin(A);
  const cosB = Math.cos(B);
  const sinB = Math.sin(B);

  const lx = 0.28;
  const ly = 0.92;
  const lz = -0.28;
  const lLen = Math.hypot(lx, ly, lz);
  const Lx = lx / lLen;
  const Ly = ly / lLen;
  const Lz = lz / lLen;

  const K2 = 5.2;
  const K1 = Math.min(subW, subH) * 0.54;

  for (let theta = 0; theta < 2 * Math.PI; theta += 0.055) {
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    for (let phi = 0; phi < 2 * Math.PI; phi += 0.018) {
      const cosPhi = Math.cos(phi);
      const sinPhi = Math.sin(phi);

      const x = (R2 + R1 * cosTheta) * cosPhi;
      const y = R1 * sinTheta;
      const z = (R2 + R1 * cosTheta) * sinPhi;

      let nx = cosTheta * cosPhi;
      let ny = sinTheta;
      let nz = cosTheta * sinPhi;

      // Rotate around Z by B (plan: Z then X)
      let x1 = x * cosB - y * sinB;
      let y1 = x * sinB + y * cosB;
      let z1 = z;
      let nx1 = nx * cosB - ny * sinB;
      let ny1 = nx * sinB + ny * cosB;
      let nz1 = nz;

      // Rotate around X by A
      const x2 = x1;
      const y2 = y1 * cosA - z1 * sinA;
      const z2 = y1 * sinA + z1 * cosA;
      const nx2 = nx1;
      const ny2 = ny1 * cosA - nz1 * sinA;
      const nz2 = ny1 * sinA + nz1 * cosA;

      const nLen = Math.hypot(nx2, ny2, nz2) || 1;
      const nnx = nx2 / nLen;
      const nny = ny2 / nLen;
      const nnz = nz2 / nLen;

      const invZ = 1 / (z2 + K2);
      const px = Math.floor(subW / 2 + K1 * x2 * invZ);
      const py = Math.floor(subH / 2 - K1 * y2 * invZ * 0.5);

      if (px < 0 || px >= subW || py < 0 || py >= subH) continue;

      const idx = py * subW + px;
      if (invZ > zbuf[idx]!) {
        zbuf[idx] = invZ;
        const diffuse = Math.max(0, nnx * Lx + nny * Ly + nnz * Lz);
        const facing = Math.max(0, nnz);
        const tangentRim = Math.hypot(nnx, nny);
        const rim = Math.pow(tangentRim, 1.35) * (0.22 + 0.18 * facing);
        const ambient = 0.1;
        const s = ambient + 0.72 * diffuse + rim;
        shade[idx] = Math.min(1, s);
      }
    }
  }

  const lines: string[] = [];
  for (let cy = 0; cy < height; cy++) {
    let row = "";
    const rowBias = cy / Math.max(1, height - 1);
    for (let cx = 0; cx < width; cx++) {
      let bits = 0;
      let sumS = 0;
      let count = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const px = cx * 2 + dx;
          const py = cy * 4 + dy;
          const i = py * subW + px;
          if (zbuf[i]! > 0) {
            bits |= brailleBit(dx, dy);
            sumS += shade[i]!;
            count++;
          }
        }
      }
      if (bits === 0) {
        row += " ";
      } else {
        const colBias = cx / Math.max(1, width - 1);
        const vignette = 0.94 + 0.06 * (1 - Math.hypot(colBias - 0.5, rowBias - 0.5) * 1.4);
        const t = Math.min(1, (sumS / count) * vignette);
        row += colorForShade(t) + String.fromCodePoint(BRAILLE_BASE + bits) + RESET;
      }
    }
    lines.push(row);
  }

  return lines;
}
