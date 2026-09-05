import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../public/maps')
mkdirSync(outDir, { recursive: true })

const CX = 620
const CY = 500

function ringPath(rx, ry) {
  return `M ${CX - rx},${CY} A ${rx} ${ry} 0 1 0 ${CX + rx},${CY} A ${rx} ${ry} 0 1 0 ${CX - rx},${CY}`
}

const layers = [
  {
    id: 'tram',
    from: 1935,
    color: '#8b9bab',
    width: 1.35,
    opacity: 0.5,
    d: [
      `M ${CX - 110},${CY - 8} L ${CX + 125},${CY + 6}`,
      `M ${CX - 30},${CY - 105} L ${CX + 18},${CY + 118}`,
      `M ${CX - 95},${CY + 55} L ${CX + 88},${CY + 72}`,
      `M ${CX - 70},${CY - 70} L ${CX + 40},${CY - 40} L ${CX + 95},${CY + 20}`,
      `M ${CX + 50},${CY - 90} L ${CX + 70},${CY + 40}`,
    ].join(' '),
  },
  {
    id: 'red',
    from: 1935,
    color: '#e42313',
    width: 5,
    d: `M 818,210 L 742,318 L 678,418 L ${CX},${CY} L 592,568 L 528,638 L 498,705`,
  },
  {
    id: 'green',
    from: 1958,
    color: '#4fb04f',
    width: 5,
    d: `M 652,168 L 638,318 L ${CX},${CY} L 658,655 L 678,805`,
  },
  {
    id: 'blue',
    from: 1958,
    color: '#0072ba',
    width: 5,
    d: `M 268,478 L 410,492 L ${CX},${CY} L 830,488 L 980,468 L 1095,448`,
  },
  {
    id: 'filevskaya',
    from: 1958,
    color: '#1ebce7',
    width: 3.5,
    d: `M 300,455 C 380,448 470,470 ${CX},${CY}`,
  },
  {
    id: 'ring',
    from: 1958,
    color: '#915133',
    width: 5,
    d: ringPath(118, 102),
  },
  {
    id: 'orange',
    from: 1985,
    color: '#f07e23',
    width: 5,
    d: `M 790,188 L 705,355 L ${CX},${CY} L 575,655 L 505,808`,
  },
  {
    id: 'purple',
    from: 1985,
    color: '#943e90',
    width: 5,
    d: `M 330,262 L 490,392 L ${CX},${CY} L 768,612 L 905,742`,
  },
  {
    id: 'gray',
    from: 1985,
    color: '#b0b0b0',
    width: 5,
    d: `M 555,175 L 588,345 L ${CX},${CY} L 605,690 L 582,838`,
  },
  {
    id: 'yellow',
    from: 1985,
    color: '#ffcd1c',
    width: 5,
    d: `M ${CX},${CY} L 790,522 L 930,535 L 1088,508`,
  },
  {
    id: 'lime',
    from: 2002,
    color: '#b4d445',
    width: 5,
    d: `M ${CX},${CY} L 728,590 L 792,698 L 838,818`,
  },
  {
    id: 'butovo',
    from: 2002,
    color: '#82c0c0',
    width: 3.5,
    d: `M 575,655 L 548,742 L 522,838`,
  },
  {
    id: 'mcc',
    from: 2016,
    color: '#d85e2f',
    width: 4.5,
    d: ringPath(248, 214),
  },
  {
    id: 'mcd1',
    from: 2016,
    color: '#faa4a4',
    width: 3,
    dash: '10 8',
    d: `M 210,355 L ${CX},${CY} L 1125,655`,
  },
  {
    id: 'mcd2',
    from: 2016,
    color: '#9ad4f5',
    width: 3,
    dash: '10 8',
    d: `M 305,820 L ${CX},${CY} L 915,205`,
  },
  {
    id: 'bkl',
    from: 2024,
    color: '#79cdcd',
    width: 5.5,
    d: ringPath(188, 162),
  },
  {
    id: 'nekrasov',
    from: 2024,
    color: '#de62a1',
    width: 4,
    d: `M 790,522 L 915,548 L 1040,575 L 1148,602`,
  },
  {
    id: 'solntsevo',
    from: 2024,
    color: '#ffcd1c',
    width: 4,
    d: `M ${CX},${CY} L 500,545 L 390,600 L 280,655`,
  },
  {
    id: 'troitsk',
    from: 2024,
    color: '#0a6f3c',
    width: 4,
    d: `M 505,808 L 470,880 L 445,955`,
  },
]

const stations = [
  { x: 818, y: 210, from: 1935 },
  { x: CX, y: CY, from: 1935 },
  { x: 498, y: 705, from: 1935 },
  { x: 268, y: 478, from: 1958 },
  { x: 1095, y: 448, from: 1958 },
  { x: 652, y: 168, from: 1958 },
  { x: 678, y: 805, from: 1958 },
  { x: 790, y: 188, from: 1985 },
  { x: 505, y: 808, from: 1985 },
  { x: 1088, y: 508, from: 1985 },
  { x: 838, y: 818, from: 2002 },
  { x: 1148, y: 602, from: 2024 },
  { x: 280, y: 655, from: 2024 },
]

function cityFill(year) {
  if (year <= 1935) return 'M 620,355 C 705,362 778,428 782,500 C 786,578 708,642 620,648 C 532,642 458,578 460,500 C 464,428 535,348 620,355 Z'
  if (year <= 1958) return 'M 620,278 C 760,290 888,385 898,500 C 908,630 780,738 620,748 C 455,738 332,630 342,500 C 352,370 480,266 620,278 Z'
  return 'M 620,155 C 790,168 990,285 1012,500 C 1028,705 880,838 620,852 C 355,838 218,705 228,500 C 240,285 450,142 620,155 Z'
}

function svgFor(year) {
  const active = layers.filter((layer) => year >= layer.from)
  const dots = stations.filter((station) => year >= station.from)
  const showMkad = year >= 1985

  const strokes = active
    .map((layer) => {
      const glow = `<path d="${layer.d}" fill="none" stroke="${layer.color}" stroke-width="${(layer.width + 6).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round" opacity="0.22"${layer.dash ? ` stroke-dasharray="${layer.dash}"` : ''}/>`
      const line = `<path d="${layer.d}" fill="none" stroke="${layer.color}" stroke-width="${layer.width}" stroke-linecap="round" stroke-linejoin="round" opacity="${layer.opacity ?? 1}"${layer.dash ? ` stroke-dasharray="${layer.dash}"` : ''}/>`
      return glow + line
    })
    .join('')

  const stationDots = dots
    .map(
      (station) =>
        `<circle cx="${station.x}" cy="${station.y}" r="4.5" fill="#f4efe4" stroke="#141c28" stroke-width="1.6"/>`,
    )
    .join('')

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" role="img" aria-label="Схема маршрутной сети Москвы, ${year}">
  <rect width="1600" height="1000" fill="#121922"/>
  <g opacity="0.35" fill="none" stroke="#2a3a4c" stroke-width="1">
    <circle cx="${CX}" cy="${CY}" r="90"/>
    <circle cx="${CX}" cy="${CY}" r="180"/>
    <circle cx="${CX}" cy="${CY}" r="270"/>
    <circle cx="${CX}" cy="${CY}" r="360"/>
    <path d="M ${CX - 420},${CY} H ${CX + 430} M ${CX},${CY - 360} V ${CY + 370}"/>
  </g>
  <path d="M 80,40 H 1520 V 960 H 80 Z" fill="none" stroke="#243140" stroke-width="1.2"/>
  <path d="${cityFill(year)}" fill="#1c2a38" stroke="#3d5368" stroke-width="1.8"/>
  ${showMkad ? `<ellipse cx="${CX}" cy="${CY}" rx="400" ry="345" fill="none" stroke="#6d7f90" stroke-width="3.2" stroke-dasharray="14 10" opacity="0.85"/>` : ''}
  <path d="M 240,540 C 340,500 410,455 490,488 C 555,514 590,575 640,598 C 720,632 790,555 870,512 C 940,478 1020,490 1140,530" fill="none" stroke="#3d6f84" stroke-width="14" stroke-linecap="round"/>
  <path d="M 240,540 C 340,500 410,455 490,488 C 555,514 590,575 640,598 C 720,632 790,555 870,512 C 940,478 1020,490 1140,530" fill="none" stroke="#7fb7c9" stroke-width="6" stroke-linecap="round" opacity="0.55"/>
  <g>${strokes}</g>
  <g>${stationDots}</g>
  <text x="72" y="86" fill="#d7c4a3" font-family="Georgia, 'Times New Roman', serif" font-size="22" letter-spacing="3">МОСКВА</text>
  <text x="72" y="126" fill="#8f9aa8" font-family="system-ui, sans-serif" font-size="15" letter-spacing="2">маршрутная сеть · ${year}</text>
</svg>
`
}

for (const year of [1935, 1958, 1985, 2002, 2016, 2024]) {
  writeFileSync(join(outDir, `${year}.svg`), svgFor(year))
}

console.log('wrote', outDir)
