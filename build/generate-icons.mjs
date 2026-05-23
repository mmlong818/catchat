// Convert build/icon.svg → PNG (multiple sizes) + ICO for electron-builder
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const svgPath = path.join(__dirname, 'icon.svg');
const svg = fs.readFileSync(svgPath);

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

async function main() {
  // Main 512px PNG used by electron-builder
  await sharp(svg).resize(512, 512).png().toFile(path.join(__dirname, 'icon.png'));
  console.log('✓ icon.png (512×512)');

  // Generate multiple sizes for ICO
  const iconBuffers = [];
  for (const size of [16, 32, 48, 64, 128, 256]) {
    const buf = await sharp(svg).resize(size, size).png().toBuffer();
    iconBuffers.push(buf);
  }
  const ico = await pngToIco(iconBuffers);
  fs.writeFileSync(path.join(__dirname, 'icon.ico'), ico);
  console.log('✓ icon.ico (multi-resolution)');

  // Also a 1024 PNG as master
  await sharp(svg).resize(1024, 1024).png().toFile(path.join(__dirname, 'icon-1024.png'));
  console.log('✓ icon-1024.png (master)');

  console.log('\nDone. Icons generated in build/');
}

main().catch((e) => { console.error(e); process.exit(1); });
