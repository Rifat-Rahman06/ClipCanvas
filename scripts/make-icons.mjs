import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const SIZES = [16, 32, 48, 128];

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#256d5b"/>
  <path d="M40 24h48v76a6 6 0 0 1-9.7 4.7L64 93.2 49.7 104.7A6 6 0 0 1 40 100V24Z" fill="#fbfaf6"/>
  <path d="M52 44h24M52 58h24" stroke="#256d5b" stroke-width="7" stroke-linecap="round"/>
</svg>`;

export async function generateIcons(outDir = path.join(root, 'public', 'icons')) {
  await mkdir(outDir, { recursive: true });
  const svg = Buffer.from(ICON_SVG);
  await Promise.all(
    SIZES.map((size) =>
      sharp(svg, { density: 512 })
        .resize(size, size, { fit: 'contain' })
        .png({ compressionLevel: 9 })
        .toFile(path.join(outDir, `icon${size}.png`)),
    ),
  );
  return SIZES.map((size) => path.join(outDir, `icon${size}.png`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  const files = await generateIcons(target);
  console.log(`Generated ${files.length} ClipCanvas icons:`);
  for (const file of files) console.log(`  ${path.relative(root, file)}`);
}
