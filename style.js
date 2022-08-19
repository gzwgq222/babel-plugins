const path = require('path')
const fs = require('fs-extra')
const babel = require('@babel/core')
const t = babel.types
const htmlparser2 = require('htmlparser2')

const sourcesPath = '../../src'
const dynamicClassReg = /{{(.+)\?(.+):(.+)}}/

// 根据路径获取文件、文件夹
const getFiles = filePath => fs.readdirSync(path.join(__dirname, filePath))

// 根据 file path 径获取 file stats
const getStatsSync = filePath => {
  return new Promise(resolve => {
    fs.stat(path.join(__dirname, filePath), (err, stats) => {
      if (!err) resolve(stats)
    })
  })
}

const styleMap = {}

// 获取当前处理的模块所有文件的路径集合
const getDelModuleFilesPath = (() => {
  // 处理模块的 config 路径
  const filePaths = []

  return async function(filePath) {
    const files = getFiles(filePath)

    for (const file of files) {
      const nextLevelFilePath = `${filePath}/${file}`
      const stats = await getStatsSync(nextLevelFilePath)

      // 为文件夹则继续查找路径
      stats.isDirectory()
        ? // eslint-disable-next-line no-caller
          await arguments.callee(nextLevelFilePath)
        : filePaths.push(nextLevelFilePath)
    }

    return filePaths
  }
})()

const strSize = (str, charset = 'utf8') => {
  let total = 0

  charset = charset.toLowerCase() || ''

  for (let i = 0; i < str.length; i++) {
    const charCode = str.charCodeAt(i)

    if (charset === 'utf-16' || charset === 'utf16') {
      total += charCode <= 0xffff ? 2 : 4
    } else {
      if (charCode <= 0x007f) {
        total += 1
      } else if (charCode <= 0x07ff) {
        total += 2
      } else if (charCode <= 0xffff) {
        total += 3
      } else {
        total += 4
      }
    }
  }

  return total
}

const getStr = (name, counts) =>
  new Array(counts).fill(`${name};`).reduce((pre, cur) => pre + cur, '')

const getWxmlFilePath = filesPath =>
  filesPath.filter(path => /.wxml$/.test(path))

const parserWxml = (code, path) => {
  const classNames = []
  const parser = new htmlparser2.Parser({
    onattribute(name, value) {
      if (!value) return

      value = value.trim().replace(/;$/, '')
      // console.log(name, value)
      if (name === 'style' && !value.includes('{{')) {
        styleMap[value] = (styleMap[value] || 0) + 1
      }
    }
  })

  parser.write(code)
  parser.end()

  return classNames
}

const format = data => {
  const list = []

  for (const key in data) {
    const counts = data[key]

    list.push({
      name: key,
      counts,
      size: strSize(getStr(key, counts)) / 1000
    })
  }

  return list
}

getDelModuleFilesPath(sourcesPath)
  .then(filePaths => {
    const wxmlFilePaths = getWxmlFilePath(filePaths)

    return wxmlFilePaths
  })
  .then(res => {
    for (const path of res) {
      const wxmlSource = fs.readFileSync(path, {
        encoding: 'utf-8'
      })

      parserWxml(wxmlSource, path)
    }

    const formatData = format(styleMap)
      .filter(el => el.counts > 2)
      .sort((a, b) => b.counts - a.counts)

    const totals =
      formatData
        .reduce((pre, cur) => {
          return pre + cur.size
        }, 0)
        .toFixed(2) + 'KB'

    const clipTotals =
      formatData
        .reduce((pre, cur) => {
          return pre + (cur.size / cur.counts) * (cur.counts - 1)
        }, 0)
        .toFixed(2) + 'KB'

    console.log('size: ', totals, clipTotals)

    formatData.unshift({
      size: totals,
      clipSize: clipTotals
    })

    fs.writeJSONSync('./style.json', formatData)
  })
