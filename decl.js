const path = require('path')
const postcss = require('postcss')
const postcssScss = require('postcss-scss')
const fs = require('fs-extra')
const htmlparser2 = require('htmlparser2')

const sourcesPath = '../../src'

const declMap = {}
const base64Map = {}

const flexKeys = ['flex', 'flex-center-xy', 'flex-column', 'flex-row']

let flexTotal = 0
let onece = 0

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

const collectDecl = postcss.plugin('collect-decl', scssPath => {
  return root => {
    root.walkDecls(decl => {
      const { prop, value } = decl
      const declKey = `${prop}:${value}`

      if (value.includes('data:image')) {
        base64Map[scssPath] = (base64Map[scssPath] || '') + value
      } else {
        declMap[declKey] = (declMap[declKey] || 0) + 1
      }
    })

    root.walkAtRules(rule => {})
  }
})

const parserWxml = code => {
  const parser = new htmlparser2.Parser({
    onattribute(name, value) {
      if (name === 'class') {
        const valArr = value.split(' ')
        const matchNumbers = flexKeys.reduce((pre, cur) => {
          if (valArr.find(el => el === cur)) {
            pre += 1
          }

          return pre
        }, 0)

        // console.log(222, name, value)

        if (matchNumbers > 1) {
          // 在同一个元素上使用 flexKeys 中的类多次
          flexTotal += 1
          // console.log('重复', matchNumbers, value.split(' '))
        } else if (matchNumbers === 1 && !valArr.find(el => el === 'flex')) {
          // 使用 flexKeys 中的类且不是 flex 类，可替换为 flex 类，减少体积
          onece += 1
          // console.log(333, valArr)
        }
      }
    }
  })

  parser.write(code)
  parser.end()

  return []
}

const parserScss = (css, scssPath) => {
  postcss([collectDecl(scssPath)])
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

      const wxmlPath = scssPath.replace('.scss', '.wxml')
      const sourceWxml =
        fs.existsSync(wxmlPath) &&
        fs.readFileSync(wxmlPath, {
          encoding: 'utf-8'
        })

      parserScss(scssSource, scssPath)

      // if (wxmlPath.includes('refundApply')) {
      parserWxml(sourceWxml)
      // }
    }

    console.log('在同一个元素上使用 flexKeys 中的类多次：', `${flexTotal} 次`)
    console.log('使用 flexKeys 中的类且不是 flex 类：', `${onece} 次`)

    const list = []
    const base64List = []

    // console.log(111, declMap)

    const getStr = (name, counts) =>
      new Array(counts).fill(`${name};`).reduce((pre, cur) => pre + cur, '')

    const getStrSize = str => (strSize(str) / 1000).toFixed(1)

    // 样式 decl
    for (const key in declMap) {
      const counts = declMap[key]

      const declStr = getStr(key, counts)

      list.push({
        name: key,
        counts,
        size: getStrSize(declStr)
      })
    }

    // base64
    for (const key in base64Map) {
      const base64 = base64Map[key]

      base64List.push({
        name: key,
        size: getStrSize(base64)
      })
    }

    //
    // const descList = list.sort((a, b) => b.counts - a.counts)

    const sizeBeyondOneKbList = list
      .filter(el => el.size >= 1)
      .sort((a, b) => b.size - a.size)

    const sizeBeyondOneKbTotals = sizeBeyondOneKbList.reduce(
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
    const listDecs = list.sort((a, b) => b.counts - a.counts)
    const countBeyond100 = listDecs.filter(el => el.counts >= 100)

    const countBeyond100Totals = countBeyond100.reduce(
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

    const base64ListDecs = base64List.sort((a, b) => b.size - a.size)

    const base64ListTotals = base64ListDecs.reduce(
      (pre, cur) => {
        pre.name.push(cur.name.slice(10))
        pre.val.push(cur.size)
        pre.size = pre.size + Number(cur.size)

        return pre
      },
      {
        name: [],
        val: [],
        size: 0
      }
    )

    // delivery/pages/account/account.scss

    console.log('base64：', base64ListTotals)

    console.log('重复设置 99 次：', countBeyond100Totals)

    console.log('样式属性大小超 1KB 的属性总计：', sizeBeyondOneKbTotals)

    // fs.writeJSONSync('./base64.json', base64ListDecs)
    // fs.writeJSONSync('./declMorethanOneKB.json', sizeBeyondOneKbList)
  })
