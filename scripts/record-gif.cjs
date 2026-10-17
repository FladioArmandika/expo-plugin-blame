// Records docs/report.gif from an HTML report. Needs Playwright and ffmpeg:
//   node dist/cli.js examples/demo --html /tmp/demo.html
//   node scripts/record-gif.cjs /tmp/demo.html /tmp/frames
//   ffmpeg -framerate 10 -i /tmp/frames/f%04d.png -vf "scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=none" docs/report.gif
const { chromium } = require('playwright');
(async () => {
  const [file, out] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 680 }, colorScheme: 'light' });
  await page.goto('file://' + file);
  let n = 0;
  const shot = async (holdFrames = 1) => {
    const buf = await page.screenshot();
    for (let i = 0; i < holdFrames; i++) require('fs').writeFileSync(`${out}/f${String(n++).padStart(4, '0')}.png`, buf);
  };
  const scrollTo = async (y, steps = 12) => {
    const start = await page.evaluate(() => window.scrollY);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      await page.evaluate((v) => window.scrollTo(0, v), start + (y - start) * e);
      await shot();
    }
  };
  const top = (sel) => page.evaluate((s) => document.querySelector(s).getBoundingClientRect().top + window.scrollY - 16, sel);
  await shot(25);                                            // overview
  await scrollTo(await top('section[id$="Info-plist"]'), 16); // to the clash
  await shot(20);
  await page.evaluate(() => document.querySelector('.chip[data-step="3"]').click());
  await shot(20);                                            // highlight withCameraCopy (scrolled view keeps chips offscreen)
  await page.evaluate(() => document.querySelector('.chip[data-step="3"]').click());
  await scrollTo(0, 12);
  await page.evaluate(() => document.querySelector('.chip[data-step="0"]').click());
  await shot(15);                                            // highlight expo-camera at top
  await page.evaluate(() => document.querySelector('.chip[data-step="0"]').click());
  await page.click('label[for=tab-plugins]');
  await shot(12);
  await scrollTo(await top('.plugin[data-step="3"]'), 16);   // the diff view of the clash
  await shot(25);
  await browser.close();
  console.log('frames', n);
})();
