// Writes a folder as a zip file with Node alone, the same on every system: each file deflated, names in UTF-8, under an optional
// folder name at the root of the zip. Every folder gets an entry of its own before its files, as zip and bsdtar write them. Without
// those entries `file`, which CTAN runs on each upload, takes the zip for a Microsoft Office document.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

// The folders and files below a folder, in order, each folder before what it holds.
function entriesOf(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? [{ path, folder: true }, ...entriesOf(path)] : [{ path, folder: false }]
    })
}

// The time of the zip in the format of MS-DOS, which every zip reader reads.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, day }
}

export function zipFolder(dir, out, root = '') {
  const { time, day } = dosTime(new Date())
  const entries = entriesOf(dir).map(({ path, folder }) => ({
    name: (root ? `${root}/` : '') + relative(dir, path).split(sep).join('/') + (folder ? '/' : ''),
    path,
    folder,
  }))
  if (root) entries.unshift({ name: `${root}/`, path: dir, folder: true })
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    // A folder is stored empty; a file is deflated.
    const data = entry.folder ? Buffer.alloc(0) : readFileSync(entry.path)
    const packed = entry.folder ? data : deflateRawSync(data, { level: 9 })
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(entry.folder ? 10 : 20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(entry.folder ? 0 : 8, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(day, 12)
    header.writeUInt32LE(entry.folder ? 0 : crc32(data), 14)
    header.writeUInt32LE(packed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    header.copy(central, 6, 4, 30)
    // The attribute of a folder in MS-DOS.
    central.writeUInt32LE(entry.folder ? 0x10 : 0, 38)
    central.writeUInt32LE(offset, 42)
    locals.push(header, name, packed)
    centrals.push(central, name)
    offset += header.length + name.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(out, Buffer.concat([...locals, directory, end]))
}
