/**
 * 收集主框架 src/components 组件被那些子模块依赖
 * 作用：
 *   1. 明确各组件被引用的关系
 *   2. 修改功能组件时便于开发、测试确认验证范围
 * 运行
 *  1. npm run deps --module=promo （指定收集模块依赖）
 *  2. npm run deps （不指定收集模块，收集 src/pages 下的所有模块）
 *
 * 支持按模块增量收集 deps
 */

const path = require('path')
const fs = require('fs')
const babel = require('@babel/core');
const t = require('@babel/types');
const prettier = require('prettier')
const { parse } = require('@babel/parser')
const _ = require('lodash')
// path 路径处理的临时替换操作符
const operator = '='
const depsModule = process.env.npm_config_module
// 子模块的依赖集合
let sourcesMap = {}
// pure
const output = '../src/components/deps.json'
const outputPure = '../src/components/pureDeps.json'

// 忽略处理的文件夹
const ignoreDirectorys = ['node_modules', 'dist', '.git']
// src/components 相对路径引入的匹配正则
const componentsRelativeReg = /src(\\|\/)components/
// components/xxx  别名引入的匹配正则
const componentsAlias = /^components/

// 根据路径获取文件、文件夹
const getFiles = (filePath) => fs.readdirSync(path.join(__dirname, filePath))
// 根据 file path 径获取 file stats
const getStatsSync = (filePath) => {
  return new Promise((resolve) => {
    fs.stat(path.join(__dirname, filePath), (err, stats) => {
      if (!err)  resolve(stats)
    })
  })
}

// 将引入资源的 path 切割为数组 a/b/c.js => [a, b, c.js]
const getPathArrayByPath = (path) => path.replace(/\\|\//g, operator).split(operator)

// 获取当前处理的模块所有文件的路径集合
const getDelModuleAllFilesPath = () => {
  // 处理模块的 config 路径
  let configPaths = []
  return async function (filePath) {
    const files = getFiles(filePath).filter(file => !ignoreDirectorys.find(ignoreFile => ignoreFile === file))

    for (const file of files) {
      const nextLevelFilePath = `${filePath}/${file}`
      const stats = await getStatsSync(nextLevelFilePath)
      // 为文件夹则继续查找路径
      if (stats.isDirectory()) {
       await arguments.callee(nextLevelFilePath)
      } else {
        configPaths.push(nextLevelFilePath)
      }
    }

    return configPaths
  }
}

/**
 * 根据正则对数据进行过滤
 * @param { Array } filesPath 原数据
 * @param { RegExp } filterReg 正则
 * @returns 过滤后的数据
 */
const getDelModuleAllMatchPath = (filesPath, diffModule) => {
  const JSXReg = new RegExp(`(components|(${diffModule}/pages)).*(.jsx|.js)$`)
  const configPaths = filesPath.filter(path => JSXReg.test(path))

  return configPaths
}

// 获取 alias 别名的相对路径
const delAliasRelativePath = (completeDepsPath) => {
  const completeDepsPathArray = getPathArrayByPath(completeDepsPath)
  const srcIndex = completeDepsPathArray.indexOf('src')
  let srcPath = completeDepsPathArray.slice(srcIndex)
  srcPath.pop()
  const relativePath = new Array(srcPath.length).join('../')

  return relativePath
}

const getDeps = (depsPath) => {
  let deps = {}
  const source = fs.readFileSync(path.join(__dirname, depsPath), {encoding: 'utf-8'})
  const ast = parse(source, {
    // parse in strict mode and allow module declarations
    sourceType: 'module',
    plugins: [
      'jsx',
      'decorators-legacy',
      // 'classProperties'
    ],
  })

  const dirName = path.dirname(depsPath)
  const completeDepsPath = path.join(__dirname, depsPath)

  babel.traverse(ast, {
    ImportDeclaration(nodePath) {
      const { node } = nodePath
      const value = node.source.value

      // 处理以 components 别名引入的资源 如： components/If
      if (componentsAlias.test(value)) {
        const relativePath = delAliasRelativePath(completeDepsPath)
        const resolvePath = path.resolve(__dirname, dirName, relativePath + value)
        deps.resolvePath ?
            deps[resolvePath].push(completeDepsPath) :
            deps[resolvePath] = [completeDepsPath]
      } else if (value.includes('./')) {
        const resolvePath = path.join(__dirname, dirName, value)

        // 处理以 components 相对路径引入的资源 如： ../../../../components/If
        if (componentsRelativeReg.test(resolvePath)) {
          deps.resolvePath ?
            deps[resolvePath].push(completeDepsPath) :
            deps[resolvePath] = [completeDepsPath]
        }
      }
    }
  })

  return deps
}


// begin del
const collectModuleDeps = async (delModulePath, diffModule) => {
  // 临时暂存数据
  let sources = {};

  // 获取当前 delModulePath 文件夹下的所有文件路径
  const filesPath = await getDelModuleAllFilesPath()(delModulePath);
  // 对所有的 path 进行过滤，获取需要的 path
  const matchFilesPaths = getDelModuleAllMatchPath(filesPath, diffModule);
  matchFilesPaths.forEach(dep => {
    const deps = getDeps(dep);

    for (const item in deps) {
      if (sources[item]) {
        sources[item].push(...deps[item]);
      } else {
        sources[item] = deps[item];
      }
    }
  });
  const keys = Object.keys(sources);
  keys.forEach(el => {
    const urlArray = getPathArrayByPath(el);
    const srcIndex = urlArray.indexOf('src');
    // src/components/xxx 以组件名 xxx 作为 key
    const shortUrl = urlArray.slice(srcIndex + 2).join('/');

    if (!sourcesMap[shortUrl])
      sourcesMap[shortUrl] = {};
    if (!sourcesMap[shortUrl][diffModule])
      sourcesMap[shortUrl][diffModule] = [];

    sources[el].forEach(source => {
      const sourceArray = getPathArrayByPath(source);
      const diffModuleIndex = sourceArray.indexOf(diffModule);
      const sourceUrl = sourceArray.slice(diffModuleIndex + 1);
      sourcesMap[shortUrl][diffModule].push(sourceUrl.join('/'));
    });

  });
}

const getPureSources = (sources) => {
  let pureSourcesMap = {}
  Object.keys(sources).forEach(key => {
    const modules = Object.keys(sources[key])
    pureSourcesMap[key] = modules
  })

  return pureSourcesMap
}

// prettier 格式化 code
const code =  (sources) => prettier.format(
  typeof sources === 'object' ? JSON.stringify(sources) : sources,
  {
    parser:'json',
    singleQuote: true,
    trailingComma: 'all',
    quoteProps:'consistent',
    printWidth: 120
  }
)

const getModuleDeps = async () => {
  const files = depsModule ? [depsModule] : getFiles('../src/pages')
  for (const file of files) {
    console.log(`开始处理：${file}`)
    const selectedModulePath = `../src/pages/${file}`

    await collectModuleDeps(selectedModulePath, file)
    console.log(`处理结束：${file} \n`)
  }

  const depsPath = path.join(__dirname, output)
  const pureDepsPath = path.join(__dirname, outputPure)

  // json 文件存在则将 json 文件内容和当前处理的模块 sourcesMap 进行合并后再写入
  if (fs.existsSync(depsPath)) {
    const existsJson = fs.readFileSync(depsPath, 'utf-8')
    const mergeSource = _.merge(JSON.parse(existsJson), sourcesMap)
    fs.writeFileSync(depsPath, code(mergeSource))
    fs.writeFileSync(pureDepsPath, code(getPureSources(mergeSource)))
  } else {
    // json 文件不存在则直接写入
    fs.writeFileSync(depsPath, code(sourcesMap))
    fs.writeFileSync(pureDepsPath, code(getPureSources(sourcesMap)))
  }
}

getModuleDeps()