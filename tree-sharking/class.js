const path = require("path");
const fs = require("fs");
const babel = require("@babel/core");
const t = babel.types;
const prettier = require("prettier");
const htmlparser2 = require("htmlparser2");
const postcss = require("postcss");
const postcssScss = require("postcss-scss");
// const CSSselect = require('css-select')
// const purifycss = require('purify-css')
// const postcssNested = require('postcss-nested')

const sourcesPath = "../../src";
const dynamicClassReg = /{{(.+)\?(.+):(.+)}}/;

// https://www.postcss.com.cn/

// 根据路径获取文件、文件夹
const getFiles = (filePath) => fs.readdirSync(path.join(__dirname, filePath));

// 根据 file path 径获取 file stats
const getStatsSync = (filePath) => {
  return new Promise((resolve) => {
    fs.stat(path.join(__dirname, filePath), (err, stats) => {
      if (!err) resolve(stats);
    });
  });
};

// 获取当前处理的模块所有文件的路径集合
const getDelModuleFilesPath = (() => {
  // 处理模块的 config 路径
  const filePaths = [];

  return async function (filePath) {
    const files = getFiles(filePath);

    for (const file of files) {
      const nextLevelFilePath = `${filePath}/${file}`;
      const stats = await getStatsSync(nextLevelFilePath);

      // 为文件夹则继续查找路径
      stats.isDirectory()
        ? // eslint-disable-next-line no-caller
          await arguments.callee(nextLevelFilePath)
        : filePaths.push(nextLevelFilePath);
    }

    return filePaths;
  };
})();

const getWxmlFilePath = (filesPath) =>
  filesPath.filter((path) => /.wxml$/.test(path));

const parserWxml = (code) => {
  const classNames = [];
  const names = ["class", "hover-class"];
  const parser = new htmlparser2.Parser({
    onattribute(name, value) {
      if (names.find((el) => el === name) && value.trim()) {
        const classNamesArr = value.split(" ").filter((val) => val);

        classNamesArr.forEach((className) => {
          // 清除以 {{ 开头的字符
          if (className.includes("{{")) return;
          // 转换 "'className'" 为 "className"
          const matchs = className.match(/(\w|\d|_|-)+/);

          if (matchs) {
            classNames.push(matchs[0]);
          }
        });
      }
    },
  });

  parser.write(code);
  parser.end();

  return classNames;
};

const ruleNodeExsit = (nodes) => nodes.some((node) => node.type === "rule");

const removeUnuseClass = postcss.plugin("check-depth", (classNameKeys) => {
  return (root) => {
    root.walkRules((rule) => {
      const { selector, nodes } = rule;

      // : :: 伪类不做清除处理
      if (selector.includes(":")) return;
      // console.log('selector', selector, selector.match(/\.()/))

      const getSelector = (selector) => {
        let path = selector;

        const loop = (joinPath, rule) => {
          if (
            joinPath.includes("&") &&
            !joinPath.includes("&.") &&
            rule.parent
          ) {
            path = path.replace("&", rule.parent.selector);

            return loop(path, rule.parent);
          } else {
            return path.replace("&", "").replace(".", "");
          }
        };

        return loop(path, rule);
      };

      // 只处理 .age 的类选择器
      if (/(\.|&)/g.test(selector)) {
        const completeSelector = getSelector(selector);

        const exsit = classNameKeys.some((el) => completeSelector.includes(el));

        console.log(
          111,
          completeSelector,
          !exsit ? "可能不存在" : "",
          !ruleNodeExsit(nodes) ? "最里层" : ""
        );

        // 在 wxml 中不存在引用关系且内部不包含选择器的才能删除
        if (!exsit && !ruleNodeExsit(nodes)) {
          console.log("不存在: ", completeSelector, selector);
          const preNode = rule.prev();

          // 删除注释
          if (preNode && preNode.type === "comment") {
            preNode.remove();
          }

          rule.remove();

          // 向上查找对空的父节点做删除处理
          const removeParentNodeLoop = (node) => {
            if (!node.parent) return;

            // 不存在 rule 节点
            if (!ruleNodeExsit(node.parent.nodes)) {
              console.log(222, "循环删除", node.parent.selector);
              node.parent.remove();
            }

            removeParentNodeLoop(node.parent);
          };

          removeParentNodeLoop(rule);
        }
      }
    });

    root.walkAtRules((rule) => {
      const { name, params } = rule;

      if (name === "keyframes") {
        const exsit = classNameKeys.some((el) => params.includes(el));

        if (!exsit) {
          // console.log(11, rule.name)
          rule.remove();
        }
      }
    });
  };
});

const parserScss = (css, classNameKeys, scssPath) => {
  console.log(333, classNameKeys);

  postcss([removeUnuseClass(classNameKeys)])
    .process(css, { parser: postcssScss })
    .then((result) => {
      // console.log('555', classNameKeys)
      // fs.writeFileSync(scssPath, result.css)
    });
};

const handleRemoveUnuseClass = ({ wxmlPath, scssPath }) => {
  const wxmlSource = fs.readFileSync(wxmlPath, {
    encoding: "utf-8",
  });

  const scssSource = fs.readFileSync(scssPath, {
    encoding: "utf-8",
  });

  // postcss()
  // .process(scssSource, { parser: postcssScss })
  // .then(result => {
  //   let options = {
  //     output: scssPath
  //   }
  //   purifycss(wxmlSource,  result.css, options)
  // })

  const classNames = parserWxml(wxmlSource);

  parserScss(scssSource, classNames, scssPath);
};

getDelModuleFilesPath(sourcesPath)
  .then((filePaths) => {
    const wxmlFilePaths = getWxmlFilePath(filePaths);
    const filesCach = [];

    for (const wxmlFilePath of wxmlFilePaths) {
      const wxmlPath = path.join(__dirname, wxmlFilePath);
      const scssPath = wxmlPath.replace(".wxml", ".scss");

      if (fs.existsSync(scssPath)) {
        filesCach.push({
          wxmlPath,
          scssPath,
        });
      }
    }

    return filesCach;
  })
  .then((res) => {
    for (const item of res) {
      // if (item.scssPath.includes('errorTipsView.scss')) {
      // if (item.scssPath.includes('groupIndex.scss')) {
      if (item.scssPath.includes("againBuyModal.scss")) {
        handleRemoveUnuseClass(item);
      }
    }
  });

// hover-class  errorTipsView.wxml

// &-test {
// }

// &-a {
//   &-b {
//   }
// }
