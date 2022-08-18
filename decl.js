const path = require('path')
const postcss = require('postcss')
const postcssScss = require('postcss-scss')
const fs = require('fs-extra')

const sourcesPath = '../../src'

let declMap = {}

const strSize = (str, charset) => {
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

// https://www.postcss.com.cn/

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

const getScssFilePath = filesPath =>
  filesPath.filter(path => /.scss$/.test(path))

const collectDecl = postcss.plugin('collect-decl', () => {
  return root => {
    root.walkDecls(decl => {
      const { prop, value } = decl
      const declKey = `${prop}:${value}`

      if (declKey.length < 20) {
        declMap[declKey] = (declMap[declKey] || 0) + 1
      }
    })

    root.walkAtRules(rule => {})
  }
})

const parserScss = css => {
  postcss([collectDecl()])
    .process(css, { parser: postcssScss })
    .then(result => {})
}

getDelModuleFilesPath(sourcesPath)
  .then(filePaths => {
    const scssFilePaths = getScssFilePath(filePaths)

    return scssFilePaths
  })
  .then(res => {
    for (const scssPath of res) {
      const scssSource = fs.readFileSync(scssPath, {
        encoding: 'utf-8'
      })

      parserScss(scssSource)
    }

    const list = []

    // console.log(111, declMap)

    const getStr = (name, counts) =>
      new Array(counts).fill(`${name};`).reduce((pre, cur) => pre + cur, '')

    const getStrSize = str => (strSize(str, 'utf-8') / 1000).toFixed(1)

    for (const key in declMap) {
      const counts = declMap[key]

      const declStr = getStr(key, counts)

      list.push({
        name: key,
        counts,
        size: getStrSize(declStr)
      })
    }

    const descList = list.sort((a, b) => b.counts - a.counts)

    const countsMin100 = descList.filter(el => el.counts >= 100)
    // strSize

    // console.log(
    //   'name',
    //   data30.map(el => el.name)
    // )
    // console.log(
    //   'counts',
    //   data30.map(el => el.counts)
    // )

    const analyzeRes = countsMin100.reduce(
      (pre, cur) => {
        pre.name.push(cur.name)
        pre.count.push(cur.counts)
        pre.val.push(cur.size)
        pre.size = pre.size + Number(cur.size)

        return pre
      },
      {
        name: [],
        count: [],
        val: [],
        size: 0
      }
    )

    console.log('555', analyzeRes)

    fs.writeJSONSync('./decl.json', descList)
  })
