const path = require('path')
const postcss = require('postcss')
const postcssScss = require('postcss-scss')
const fs = require('fs-extra')

const sourcesPath = '../../src'

let declMap = {}

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
  postcss([collectDecl()]).process(css, { parser: postcssScss })
}

getDelModuleFilesPath(sourcesPath)
  .then(filePaths => {
    const scssFilePaths = getScssFilePath(filePaths)

    console.log(333, scssFilePaths.length)

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

    for (const key in declMap) {
      list.push({
        name: key,
        counts: declMap[key]
      })
    }

    const descList = list.sort((a, b) => b.counts - a.counts)
    const data30 = descList.slice(0, 30)
    console.log(
      'name',
      data30.map(el => el.name)
    )
    console.log(
      'counts',
      data30.map(el => el.counts)
    )
    console.log('555', data30)

    fs.writeJSONSync('./decl.json', descList)
  })
