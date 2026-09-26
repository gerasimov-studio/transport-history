import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const manifest = JSON.parse(readFileSync('dist/.vite/manifest.json', 'utf8'))
const records = Object.entries(manifest)
const entry = records.find(([, value]) => value.isEntry)?.[0]
const viewer = records.find(([key]) => key.endsWith('features/history/ViewerPage.tsx'))?.[0]

if (!entry || !viewer) {
  throw new Error('Unable to find the application entry or history viewer in the Vite manifest')
}

function dependencyFiles(rootKeys) {
  const visited = new Set()
  const files = new Set()
  const visit = (key) => {
    if (visited.has(key)) return
    visited.add(key)
    const record = manifest[key]
    if (!record) throw new Error(`Missing Vite manifest record: ${key}`)
    if (record.file?.endsWith('.js')) files.add(record.file)
    for (const dependency of record.imports ?? []) visit(dependency)
  }
  for (const key of rootKeys) visit(key)
  return files
}

function gzipBytes(file) {
  return gzipSync(readFileSync(`dist/${file}`)).byteLength
}

function format(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`
}

const initialFiles = dependencyFiles([entry, viewer])
const initialBytes = [...initialFiles].reduce((total, file) => total + gzipBytes(file), 0)
const initialBudget = 200 * 1024

const forbiddenInitialFeatures = [
  'features/editor/',
  'features/account/',
  'features/administration/',
]
for (const [key, record] of records) {
  if (forbiddenInitialFeatures.some((feature) => key.includes(feature)) && initialFiles.has(record.file)) {
    throw new Error(`${key} leaked into the initial history bundle`)
  }
}

const jsAssets = records
  .filter(([, record]) => record.file?.endsWith('.js'))
  .map(([key, record]) => ({
    key,
    file: record.file,
    raw: statSync(`dist/${record.file}`).size,
    gzip: gzipBytes(record.file),
  }))
  .sort((left, right) => right.gzip - left.gzip)

console.log('\nBundle size report (JavaScript)')
for (const asset of jsAssets) {
  console.log(`${format(asset.gzip).padStart(11)} gzip  ${format(asset.raw).padStart(12)} raw  ${asset.key}`)
}
console.log(`\nHistory initial load: ${format(initialBytes)} / ${format(initialBudget)}`)

if (initialBytes > initialBudget) {
  throw new Error(`History initial JavaScript exceeds its budget by ${format(initialBytes - initialBudget)}`)
}
