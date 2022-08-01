/*
 *  config diff
 * 思路：
 *  1. 对当前处理的模块 config 文件路径进行提取
 *  2. 将具有相同 config 文件夹的各区域 config 路径组合为二维数组
 *  3. 提取二维数组中的每个路径 code 的 ast properties 属性
 *  4. 获取二维数组中全量 properties 集合
 *  5. 每个 config 的 properties 比对当前文件夹全量的 properties, 找出差异 properties
 *  6. 将当前差异的 properties 添加到当前路径的 propertie 中
 *  7. 将经 ast 转换的 code 写入当前的 path 路径中
 */

const path = require('path')
const fs = require('fs')
const babel = require('@babel/core');
const t = require('@babel/types');
const chalk = require('chalk');
const { Select } = require('enquirer');
const modules = require('../.site/modules.config')
const prettier = require('prettier')

const bgGreen = chalk.bold.bgGreen
const bgRed = chalk.bold.bgRed
const allModules = Object.keys(modules).map(moduelPath => moduelPath.split('/').slice(-1)[0])
const diffModule = process.env.npm_config_diffModule


// 忽略处理的文件夹
const ignoreDirectorys = ['node_modules', 'dist']
// 匹配 config 路径的正则
const configPathReg = /config\/(CN|HK|JP)/

// 判断文件、文件夹是否存在
const isExistsSync = (url) => fs.existsSync(path.join(__dirname, url))
// 根据路径获取文件、文件夹
const getFiles = (filePath) => fs.readdirSync(path.join(__dirname, filePath))
// 根据 file path 径获取 file stats
const getStatsSync = (filePath) => {
  return new Promise((resolve, reject) => {
    fs.stat(path.join(__dirname, filePath), (err, stats) => {
      if (!err) {
        resolve(stats)
      }
    })
  })
}

//  config code to config ast 存储在二维数组中
const handleDelConfigCodeToConfigAst = (content, config) => {
  babel.transform(content, {
    plugins: [
      { visitor: {
        ExportDefaultDeclaration(path) {
          const { properties } = path.node.declaration
          config['ast'] = properties
        }
      }}
    ]
  });
}

// 获取当前处理的模块所有文件的路径集合
const getDelModuleAllFilesPath = (() => {
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
})()

/**
 * 根据正则对数据进行过滤
 * @param { Array } filesPath 原数据
 * @param { RegExp } filterReg 正则
 * @returns 过滤后的数据
 */
const getDelModuleAllConfigPath = (filesPath, filterReg = configPathReg) => {
  const configPaths = filesPath.filter(path => filterReg.test(path))

  return configPaths
}

// 路径关系转化为二维数组 [ [ { path: '', source: '', ast: '' } ] ]
const formatConfigPath = (filesPath) => {
  const temporaryMap = {}
  filesPath.forEach(path => {
    const key = path.split('/').slice(0, - 2).join('/')

    if (!temporaryMap[key]) temporaryMap[key] = []

    temporaryMap[key].push({ path, ast: '' })
  })
  return Object.values(temporaryMap)
}

// 获取同一个 config 文件夹下所有 key ast 集合
const getConfigDiffBySameDirectory = (array = []) => {
  return new Promise((resolve) => {
    const currentDirectoryAsts = array
      .reduce((pre, cur) => pre.concat(cur.ast), [])
      .reduce((pre, cur) => {
        if (!pre.find(el => el.key.name === cur.key.name)) pre.push(cur)
        return pre
      }, [])

    resolve({array, currentDirectoryAsts})
  })
}

// 在 diff config 的 key 前面添加 // 来转换为注释（投机取巧一下）
const handleChangeName = (path, diffConfigNode) => {
  let { properties } = path.node.declaration
  const newPropertie = diffConfigNode.reduce((pre, cur) => {
    // 深拷贝一下
    let deepCopy = JSON.parse(JSON.stringify(cur))
    deepCopy.key.name = `// ${deepCopy.key.name}`
    pre.push(deepCopy)

    return pre
  }, [])

  properties.push(...newPropertie)
}

// ast 添加差异, => 写入对应 path
const codeToSource = (configPath, diffConfigNode) => {
  const content = fs.readFileSync(path.join(__dirname, configPath), {encoding: 'utf-8'})
  let { code } = babel.transform(content, {
    compact: false,
    plugins: [
      { visitor: {
        ExportDefaultDeclaration(path) {
          handleChangeName(path, diffConfigNode)
        }
      }}
    ]
  });
  code =  prettier.format(code,{
    parser:'babel',
    singleQuote: true,
    trailingComma: 'all',
    quoteProps:'consistent',
    printWidth: 120
  })

  fs.writeFileSync(path.join(__dirname, configPath), code, 'utf8');
}

// 根据所有 config key 的 ast 集合对各区域配置文件进行转化
const handleWriteConfigDiff = ({array, currentDirectoryAsts}) => {
  for (const config of array) {
    const configAst = config.ast
    const curConfigComments = configAst.reduce((pre, cur) => {
      const {leadingComments = [], trailingComments = []} = cur
      pre.push(...trailingComments, ...leadingComments)

      return pre
    }, [])

    const diffConfigs = currentDirectoryAsts
      .filter(directoryConfig =>
        configAst.every(fileConfig =>
          directoryConfig.key.name !== fileConfig.key.name) &&
          curConfigComments.every(comments => !comments.value.trim().includes(directoryConfig.key.name))
      )

    // if (config.path === '../src/pages/promo/config/config/CN/groupConfig.js') {
    codeToSource(config.path, diffConfigs)
    // }
  }
}



const updateConfigDiff = (delModulePath) => {
  // begin del
  return getDelModuleAllFilesPath(delModulePath)
    .then(filesPath => {
      // 获取所有 config 路径
      const configPaths = getDelModuleAllConfigPath(filesPath)
      // 所有的 config 根据相同的路径关系转为二维数组
      return formatConfigPath(configPaths)
    })
    .then(async configMap  => {
      for (const configs of configMap) {
        // 在二维数组中存储 source、ast
        for (const config of configs) {
          const { path: sourcePath } = config
          const source = fs.readFileSync(path.join(__dirname, sourcePath), {encoding: 'utf-8'})
          config['code'] = source
          handleDelConfigCodeToConfigAst(source, config)
        }
      }
      return configMap
    })
    .then(async fileSources => {
      for (const fileSource of fileSources) {
        await getConfigDiffBySameDirectory(fileSource)
        .then(res => handleWriteConfigDiff(res))
      }
    })
    .then(res => {
      console.log(bgGreen(' config diff success! '))
    })
    .catch(err => {
      console.log(bgRed(' config diff error: ', err))
    })
}

if (diffModule) {
  const selectedModulePath = `../src/pages/${diffModule}`
  updateConfigDiff(selectedModulePath)
} else {
  const prompt = new Select({
    name: 'diff module',
    message: 'Select the module to be process config diff',
    choices: allModules
  });

  prompt.run()
    .then(selectedModule => {
      const selectedModulePath = `../src/pages/${selectedModule}`
      updateConfigDiff(selectedModulePath)
    })
}