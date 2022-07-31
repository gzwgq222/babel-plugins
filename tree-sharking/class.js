const path = require('path')
const fs = require('fs')
const babel = require('@babel/core')
const t = babel.types
const prettier = require('prettier')
const htmlparser2 = require('htmlparser2')
const { blue, red } = require('chalk')
const postcss = require('postcss')
const postcssScss = require('postcss-scss')

// 调用 setData 次数超阈值的函数集合
const callList = {}
// 设置收集阈值
const callValue = 2

const sourcesPath = '../../src'
// wxml 中匹配 {{ }}
const setDataWxmlValueReg = /{{.*}}/

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
        ? await arguments.callee(nextLevelFilePath)
        : filePaths.push(nextLevelFilePath)
    }

    return filePaths
  }
})()

const getWxmlFilePath = filesPath =>
  filesPath.filter(path => /.wxml$/.test(path))

// prettier 格式化 code
const prettierCode = sources =>
  prettier.format(
    typeof sources === 'object' ? JSON.stringify(sources) : sources,
    {
      parser: 'json',
      singleQuote: true,
      trailingComma: 'all',
      quoteProps: 'consistent'
      // printWidth: 120
    }
  )

const collectSetDataCallNumber = (code, formatFilePath) => {
  // setData 的所有 key
  const setDataKeys = []
  // 所有的 params.a = 1 成员表达式 key 收集
  const memberExpressionKeys = {}
  // 直接在 this.setData(params) 中传入对象 params 设置属性的形式，收集对象 name 集合
  const identifierKeys = {}
  // params = otherParams 赋值表达式 key 收集
  const assignmentExpressionKeys = {}

  babel.transform(code, {
    plugins: [
      {
        visitor: {
          MemberExpression(path) {
            const { node } = path
            const parent = path.findParent(parentPath =>
              parentPath.isObjectMethod()
            )

            if (!parent) return
            const fnName = parent.node.key.name

            // params.a = 1
            if (path.get('object').isIdentifier()) {
              if (path.get('property').isIdentifier()) {
                const objectName = node.object.name
                const propertyName = node.property.name

                if (!memberExpressionKeys[fnName])
                  memberExpressionKeys[fnName] = {}

                if (!memberExpressionKeys[fnName][objectName]) {
                  memberExpressionKeys[fnName][objectName] = []
                }

                memberExpressionKeys[fnName][objectName].push(propertyName)
              }
              // other type to do...
            }

            // this.setData 表达式 ThisExpression
            if (
              path.get('object').isThisExpression() &&
              path.get('property').isIdentifier({ name: 'setData' })
              // is equivalent to doing:
              // t.isThisExpression(node.object) &&
              // t.isIdentifier(node.property, { name: 'setData' })
            ) {
              // fn 收集调用 setData 次数
              if (!callList[formatFilePath]) callList[formatFilePath] = {}
              callList[formatFilePath][fnName] =
                (callList[formatFilePath][fnName] || 0) + 1

              const firstArguments = path.parent.arguments[0]

              // this.setData({ a: 1 })
              if (t.isObjectExpression(firstArguments)) {
                const { properties } = firstArguments

                for (const propertie of properties) {
                  /**
                   * this.setData({ a: 1 }) --> key is Identifier node type
                   * this.setData({ 'a.b': 1 }) --> key is StringLiteral node type
                   */

                  if (t.isObjectProperty(propertie)) {
                    const value = propertie.key.name || propertie.key.value

                    if (!setDataKeys.some(el => el === value)) {
                      setDataKeys.push(value)
                    }
                  }
                }
              }

              // console.log('对象属性')
              // this.setData(params)
              if (t.isIdentifier(firstArguments)) {
                /**
                 * params 设置属性值可能存在的形式：
                 *  1. params.a = 1  --> MemberExpression
                 *
                 *  2. params = {  --> AssignmentExpression
                 *       a: 1
                 *     }
                 */

                if (!identifierKeys[fnName]) identifierKeys[fnName] = []
                identifierKeys[fnName].push(firstArguments.name)
              }
            }
          },
          // 赋值表达式 param = { a: 1, 'a-b': 2 }
          AssignmentExpression(path) {
            const parent = path.findParent(parentPath =>
              parentPath.isObjectMethod()
            )

            if (!parent) return

            const fnName = parent.node.key.name

            if (
              path.get('left').isIdentifier() &&
              path.get('right').isObjectExpression()
            ) {
              const leftName = path.node.left.name

              const { properties } = path.node.right

              const propertieKeyValue = properties.reduce((pre, cur) => {
                if (t.isObjectProperty(cur)) {
                  pre.push(cur.key.name)
                }

                return pre
              }, [])

              if (!assignmentExpressionKeys[fnName])
                assignmentExpressionKeys[fnName] = {}
              assignmentExpressionKeys[fnName][leftName] = propertieKeyValue
            }
          }
        }
      }
    ]
  })

  return {
    setDataKeys,
    identifierKeys,
    memberExpressionKeys,
    assignmentExpressionKeys
  }
}

const parserWxml = code => {
  const classNames = []
  const parser = new htmlparser2.Parser({
    onattribute(name, value) {
      if (name === 'class' && value.trim()) {
        const className = value.split(' ').filter(val => val)

        classNames.push(...className)
      }
    }
  })

  parser.write(code)
  parser.end()

  return classNames
}

const parserScss = css => {
  const classNames = []
  postcss()
    .process(css, { parser: postcssScss })
    .then(result => {
      const data = postcss.parse(result.css)
      console.log(555, data.nodes)
    })

  return classNames
}

// 收集 this.setData(params), params = {a: 1} or params.a = 1 情况下的 key
const getSetDataKeysByidentifierType = (identifierKeys, sourcesKeys) => {
  let diffKeys = []

  Object.keys(identifierKeys).forEach(fnName => {
    const fnIdentifierValues = identifierKeys[fnName]
    const fnSourcesKeysValues = sourcesKeys[fnName]

    fnSourcesKeysValues &&
      fnIdentifierValues.forEach(value => {
        diffKeys = diffKeys.concat(fnSourcesKeysValues[value])
      })
  })

  return [...new Set(diffKeys)]
}

const handleRemoveUnuseClass = ({ wxmlPath, scssPath }) => {
  const wxmlSource = fs.readFileSync(wxmlPath, {
    encoding: 'utf-8'
  })

  let scssSource = fs.readFileSync(scssPath, {
    encoding: 'utf-8'
  })

  // console.log('scssSource', scssSource)
  parserScss(scssSource)
  // const classNames = parserWxml(wxmlSource)
  // console.log(33, classNames)
}

getDelModuleFilesPath(sourcesPath)
  .then(filePaths => {
    const wxmlFilePaths = getWxmlFilePath(filePaths)
    let filesCach = []

    for (const jsFilePath of wxmlFilePaths) {
      const wxmlPath = path.join(__dirname, jsFilePath)
      const scssPath = wxmlPath.replace('.wxml', '.scss')
      if (fs.existsSync(scssPath)) {
        filesCach.push({
          wxmlPath,
          scssPath
        })
      }
    }

    return filesCach
    // console.log('jsFilePaths', jsFilePaths.length)

    // for (const jsFilePath of jsFilePaths) {
    //   const jsPath = path.join(__dirname, jsFilePath)

    //   // console.log(11, jsPath)

    //   const wxmlPath = jsPath.replace('.js', '.wxml')

    //   const source = fs.readFileSync(jsPath, {
    //     encoding: 'utf-8'
    //   })

    //   const sourceWxml =
    //     fs.existsSync(wxmlPath) &&
    //     fs.readFileSync(wxmlPath, {
    //       encoding: 'utf-8'
    //     })

    //   if (sourceWxml) {
    //     const jsFilePathArray = jsFilePath.split('/')
    //     const srcIndex = jsFilePathArray.indexOf('src')
    //     const formatFilePath = jsFilePathArray.slice(srcIndex).join('/')

    //     const values = collectSetDataCallNumber(source, formatFilePath)

    //     const {
    //       setDataKeys,
    //       identifierKeys, // 调用 setData 直接传的对象
    //       memberExpressionKeys,
    //       assignmentExpressionKeys
    //     } = values

    //     const identifierDiffKeys = getSetDataKeysByidentifierType(
    //       identifierKeys,
    //       memberExpressionKeys
    //     )
    //     const assignmentExpressionDiffKeys = getSetDataKeysByidentifierType(
    //       identifierKeys,
    //       assignmentExpressionKeys
    //     )

    //     const totalKeys = [
    //       ...new Set([
    //         ...setDataKeys,
    //         ...identifierDiffKeys,
    //         ...assignmentExpressionDiffKeys
    //       ])
    //     ]

    //     if (sourceWxml) {
    //       const setDataWxmlKeys = parserWxml(sourceWxml)

    //       const unuseKeys = totalKeys
    //         .filter(
    //           key => !setDataWxmlKeys.find(wxmlKey => wxmlKey.includes(key))
    //         )
    //         .filter(val => val)

    //       if (unuseKeys.length) {
    //         unuseSetDataKeys[formatFilePath] = unuseKeys
    //       }
    //     }
    //   }

    //   for (const item in callList) {
    //     const pathValue = callList[item]

    //     for (const fnName in pathValue) {
    //       if (pathValue[fnName] < callValue) {
    //         delete callList[item][fnName]
    //       }
    //     }

    //     if (!Object.values(callList[item]).length) delete callList[item]
    //   }
    // }

    // const code = prettierCode(callList)
    // const unuseSetDataKeysCode = prettierCode(unuseSetDataKeys)

    // fs.writeFileSync('./lib/callee-plugin/setDataCall.json', code)
    // fs.writeFileSync(
    //   './lib/callee-plugin/unuseSetDatakeyInWxml.json',
    //   unuseSetDataKeysCode
    // )

    // console.log(
    //   blue('\n 收集结束：\n\n'),
    //   '调用 setData 次数超过',
    //   red(callValue),
    //   '次的 JS 文件总计：',
    //   red(Object.keys(callList).length),
    //   '个 \n',
    //   'setData 设置 value 但在 wxml 中未使用的 JS 文件总计：',
    //   red(Object.keys(unuseSetDataKeys).length),
    //   '个'
    // )
  })
  .then(res => {
    for (const item of res) {
      if (item.scssPath.includes('groupIndex.scss')) {
        handleRemoveUnuseClass(item)
      }
    }
  })
