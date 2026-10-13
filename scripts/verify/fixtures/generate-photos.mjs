// Regenerates the fixture photographs in ./photos.
//
// The JPEGs are committed, so this only needs to run if they change. They are
// drawn in Chromium's canvas rather than with a system image tool so the whole
// verifier toolchain stays inside npm. Mixed aspect ratios on purpose: the
// import and frame-fit paths treat landscape, portrait, and square differently.
//
//   node scripts/verify/fixtures/generate-photos.mjs

import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "photos")

const PHOTOS = [
  { name: "01-landscape.jpg", width: 900, height: 600, hues: [24, 200] },
  { name: "02-portrait.jpg", width: 600, height: 900, hues: [140, 320] },
  { name: "03-square.jpg", width: 750, height: 750, hues: [45, 260] },
  { name: "04-landscape-wide.jpg", width: 960, height: 540, hues: [190, 10] },
  { name: "05-portrait.jpg", width: 640, height: 800, hues: [90, 280] },
  { name: "06-landscape.jpg", width: 800, height: 600, hues: [300, 60] },
]

await mkdir(outDir, { recursive: true })
const browser = await chromium.launch()
const page = await browser.newPage()

for (const photo of PHOTOS) {
  const dataUrl = await page.evaluate(({ width, height, hues, name }) => {
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")

    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, `hsl(${hues[0]} 55% 45%)`)
    gradient.addColorStop(1, `hsl(${hues[1]} 45% 25%)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)

    ctx.fillStyle = "rgb(255 255 255 / 0.85)"
    ctx.beginPath()
    ctx.arc(width * 0.62, height * 0.4, Math.min(width, height) * 0.18, 0, Math.PI * 2)
    ctx.fill()

    ctx.font = `${Math.round(height / 12)}px sans-serif`
    ctx.fillText(name.replace(".jpg", ""), width * 0.06, height * 0.9)
    return canvas.toDataURL("image/jpeg", 0.8)
  }, photo)

  await writeFile(path.join(outDir, photo.name), Buffer.from(dataUrl.split(",")[1], "base64"))
  console.log(`wrote ${photo.name}`)
}

await browser.close()
