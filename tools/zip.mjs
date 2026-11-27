// Writes a folder as a zip file with Node alone, the same on every system: each file deflated, names in UTF-8, under an optional
// folder name at the root of the zip.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'

function filesOf(dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? filesOf(path) : [path]
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
  const locals = []
  const centrals = []
  let offset = 0
  for (const path of filesOf(dir)) {
    const name = Buffer.from((root ? `${root}/` : '') + relative(dir, path).split(sep).join('/'), 'utf8')
    const data = readFileSync(path)
    const packed = deflateRawSync(data, { level: 9 })
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(8, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(day, 12)
    header.writeUInt32LE(crc32(data), 14)
    header.writeUInt32LE(packed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    header.copy(central, 8, 6, 30)
    central.writeUInt32LE(offset, 42)
    locals.push(header, name, packed)
    centrals.push(central, name)
    offset += header.length + name.length + packed.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(out, Buffer.concat([...locals, directory, end]))
}
