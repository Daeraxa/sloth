/**
  This file is intended to be the be-all, end-all of the build process.
  For the laziest, least opinionated static site builder.
  Relying heavily on the root configuration file.
*/

const fs = require("fs");
const path = require("path");
const ejs = require("ejs");
const fm = require("front-matter");
const { minify } = require("terser");
const sass = require("sass");
const CleanCSS = require("clean-css");
const MarkdownIt = require("markdown-it");
const markdownItContainer = require("markdown-it-container");
const config = require("../site.config.js").config;

const DEV_MODE = process.env.NODE_ENV === "development" ? true : false;

const md = require("../site.config.js").md ?? new MarkdownIt({
  html: true
}).use(require("markdown-it-include"), { // Allows including MD fragments
  root: "./"
}).use(require("markdown-it-expandable") // Adds `<details>` and `<summary>`
).use(require("markdown-it-named-code-blocks"), { // Allows naming of code blocks
  isEnableInlineCSS: true
}).use(require("markdown-it-kbd") // Adds `<kbd>x</kbd>` support
).use(require("markdown-it-attrs"), { // supply custom attributes
  leftDelimiter: "{",
  rightDelimiter: "}",
  allowedAttributes: [] // empty array = all attributes are allowed
}).use(require("markdown-it-highlightjs"), { // code highlighting
  auto: false,
  code: true,
  inline: false
}).use(require("markdown-it-ins") // ins support
).use(require("markdown-it-sub") // subscript support
).use(require("markdown-it-sup") // super script support
).use(require("markdown-it-emoji"), { // emoji support

}).use(require("markdown-it-fontawesome") // font awesome support
).use(require("markdown-it-codetabs") // Codetabs support
).use(require("markdown-it-footnote") // Footnote support
).use(require("./markdown-it-del.js") // del support
).use(require("./markdown-it-include-ejs.js"), { // allows including EJS docs
  root: "./"
}).use(markdownItContainer, // container block support
  "warning" // each supported block has to be created seperately
).use(markdownItContainer,
  "info"
);

let sidebar;

async function main() {

  // Empty build folder
  fs.rmSync(config.buildDirectory, { recursive: true, force: true });

  // Check if our build folder exists, or create it
  await createIfDirAbsent(config.buildDirectory);

  // 0) Find our sidebar files, and keep them for injection

  if (typeof config.sidebar === "string") {
    switch(config.sidebar.split(".")[config.sidebar.split(".").length-1]) {
      case "json":
        let tmpContent = fs.readFileSync(config.sidebar);
        sidebar = JSON.parse(tmpContent);
        break;
    }
  }

  if (typeof config.sidebar === "object") {
    sidebar = config.sidebar;
  }

  // 1) Generate All HTML content

  const pageMap = {};

  const htmlFileHandler = async (file, pathArray, filename) => {
    let path;

    if (pathArray.length < 1) {
      path = `/${filename}`;
    } else {
      path = pathArray.join("/");
      path = `/${path}/${filename}`;
    }
    let page = await generatePageObject(file, pathArray, path, filename);

    if (typeof page === "boolean" && !page) {
      return;
    }

    pageMap[path] = page;
  };

  await enumerateFiles(config.sourceDirectory, [], config.buildDirectory, htmlFileHandler);

  // Now that all pages have been handled, and we have our full pageMap,
  // we can go ahead and cycle through our page map and generate pages as needed,
  // now with a global store of all other pages to be able to generate data from if needed.

  for (const page in pageMap) {
    let content = await generateHTML(pageMap[page], pageMap);

    // Write out HTML to the build dir
    fs.writeFileSync(path.join(config.buildDirectory, ...pageMap[page]._pathArray, `${pageMap[page]._filename.replace(".md", ".html")}`), content, {
      encoding: "utf8",
      flag: "w"
    });
  }

  // 2) Static File Copy. Take everything from the static folder
  config.staticSourceDirectory ??= ["./assets/static"];
  config.staticBuildDirectory ??= config.buildDirectory;

  await createIfDirAbsent(config.staticBuildDirectory);

  if (!Array.isArray(config.staticSourceDirectory)) {
    config.staticSourceDirectory = [ config.staticSourceDirectory ];
  }

  for (const staticDir of config.staticSourceDirectory) {

    if (typeof staticDir === "string") {

      await enumerateFiles(staticDir, [], config.staticBuildDirectory, (file, pathArray, filename) => {
        fs.copyFileSync(file, path.join(config.staticBuildDirectory, ...pathArray, filename));
      });

    } else if (typeof staticDir === "object") {
      await enumerateFiles(staticDir.from, [], staticDir.to, (file, pathArray, filename, immediateReturn) => {
        // Now when using this method to move files, the `to` location can either be
        // a directory, or a specific file. So we gotta check
        if (immediateReturn) {
          fs.copyFileSync(path.resolve(file), path.resolve(staticDir.to));
        } else {
          fs.copyFileSync(file, path.join(staticDir.to, ...pathArray, filename));
        }
      });
    }
  }

  // 3) Minify JavaScript
  config.jsBuildDirectory ??= config.buildDirectory;
  config.jsSourceDirectory ??= "./assets/js";
  config.jsMinifyOptions ??= {};

  await createIfDirAbsent(config.jsBuildDirectory);

  await enumerateFiles(config.jsSourceDirectory, [], config.jsBuildDirectory, async (file, pathArray, filename) => {

    let content = fs.readFileSync(file, "utf8");

    if (content.length < 1) {
      return;
    }

    if (config.jsMinifyGenerateSourceMap) {
      let tmpMinifyOptions = config.jsMinifyOptions;

      if (typeof tmpMinifyOptions.sourceMap !== "object") {
        tmpMinifyOptions.sourceMap = {
          filename: filename,
          url: `${filename.replace(".js", ".js.map")}`
        };
      }

      let output = await minify(content, config.jsMinifyOptions);

      fs.writeFileSync(path.join(config.jsBuildDirectory, ...pathArray, `${filename.replace(".js", ".min.js")}`), output.code, {
        encoding: "utf8",
        flag: "w"
      });

      fs.writeFileSync(path.join(config.jsBuildDirectory, ...pathArray, `${filename.replace(".js", ".js.map")}`), output.map, {
        encoding: "utf8",
        flag: "w"
      });
    } else {
      let output = await minify(contnet, config.jsMinifyOptions);

      fs.writeFileSync(path.join(config.jsBuildDirectory, ...pathArray, `${filename.replace(".js", ".min.js")}`), output.code, {
        encoding: "utf8",
        flag: "w"
      });
    }
  });

  // 4) Generate CSS from SCSS
  config.cssBuildDirectory ??= config.buildDirectory;
  config.cssSourceDirectory ??= "./assets/css";
  config.cssMinifyOptions ??= {};

  await createIfDirAbsent(config.cssBuildDirectory);

  await enumerateFiles(config.cssSourceDirectory, [], config.cssBuildDirectory, async (file, pathArray, filename) => {
    let content = fs.readFileSync(file, "utf8");

    if (content.length < 1 || filename.startsWith("_")) {
      // dont handle filenames starting with '_' since they are sass includes
      return;
    }

    let output = sass.compile(file);

    fs.writeFileSync(path.join(config.cssBuildDirectory, ...pathArray, filename.replace(".scss", ".css")), output.css, {
      encoding: "utf8",
      flag: "w"
    });


    // Now since we already have our source CSS available, we can much more easily
    // generate a source map of it, and minify it
    if (config.cssMinifyGenerateSourceMap) {
      let tmpMinifyOptions = config.cssMinifyOptions;

      if (typeof tmpMinifyOptions.sourceMap !== "boolean") {
        tmpMinifyOptions.sourceMap = true;
      }

      let miniOutput = new CleanCSS(tmpMinifyOptions).minify(output.css);

      fs.writeFileSync(path.join(config.cssBuildDirectory, ...pathArray, filename.replace(".scss", ".min.css")), miniOutput.styles, {
        encoding: "utf8",
        flag: "w"
      });

      // Now to finish generating our sourcemap file
      // https://github.com/mozilla/source-map/#sourcemapgenerator
      miniOutput.sourceMap._file = filename;
      miniOutput.sourceMap._sourceRoot = "/";

      fs.writeFileSync(path.join(config.cssBuildDirectory, ...pathArray, filename.replace(".scss", ".css.map")), miniOutput.sourceMap.toString(), {
        encoding: "utf8",
        flag: "w"
      });
    } else {

      let miniOutput = new CleanCSS(config.cssMinifyOptions).minify(output.css);

      fs.writeFileSync(path.join(config.cssBuildDirectory, ...pathArray, filename.replace(".scss", ".min.css")), miniOutput.styles, {
        encoding: "utf8",
        flag: "w"
      });
    }

  });

  return;
}

async function enumerateFiles(dir, pathArray, dest, fileCallback) {
  // dir: The starting directory
  // pathArray: The array of path entries
  // dest: The path of our destination
  // fileCallback: Function to invoke when a file is found.
  // When the callback is invoked the following is passed:
  // - file: Which is the file and it's preceeding path. A relative path to a specific file.
  // - pathArray: The path as an array leading up to that file, from the initial dir passed.
  // - filename: The specific files name.
  // - immediateReturn: An overloaded paramter passed only when the immediate dir
  //    passed was a direct file path.

  if (fs.lstatSync(dir).isFile()) {
    // The initial dir is a file, not a dir
    await fileCallback(dir, pathArray, path.basename(dir), true);
    return;
  }

  let files = fs.readdirSync(dir);

  for (const file of files) {
    let target = path.join(dir, file);

    if (fs.lstatSync(target).isDirectory()) {
      // Create folder in build
      // then enumerate within
      if (!fs.existsSync(path.join(dest, ...pathArray, file))) {
        fs.mkdirSync(path.join(dest, ...pathArray, file));
      }

      await enumerateFiles(`./${target}`, [ ...pathArray, file ], dest, fileCallback);
    } else {
      await fileCallback(target, pathArray, file);
    }
  }
}

async function createIfDirAbsent(file) {
  if (!fs.existsSync(file)) {
    fs.mkdirSync(file);
  }
}

async function generatePageObject(file, pathArray, path, filename) {
  const mdFile = fs.readFileSync(file, "utf8");

  const frontMatter = fm(mdFile);

  if (frontMatter.bodyBegin === 1) {
    // This happens if a file contains NO front matter.
    // We will assume this is a markdown fragment.
    return false;
  }

  // Here we will generate some helpful universally available frontmatter components.
  const universalFrontMatter = {
    _date: new Date().toDateString(),
    _timeToRead: getTimeToRead(frontMatter.body)
  };

  // Some common attribute safety checks
  // Without these values assigned, EJS will crash not ebing able to determine what they are if used in a template.
  frontMatter.attributes.title ??= "";
  frontMatter.attributes.author ??= "";

  // Now we will return an object containing all of our data.
  return {
    ...frontMatter.attributes,
    ...universalFrontMatter,
    _sidebar: sidebar,
    _markdown: frontMatter.body,
    DEV_MODE: DEV_MODE,
    _pathArray: pathArray,
    _file: file,
    _filename: filename
  };

}

async function generateHTML(page, pageMap) {
  // pageMap is a full HashMap of every single page that will be written.
  // If needed we could add additional functions here that rely on knowing the global
  // page layout such as building sidebars, or sitemaps

  const html = md.render(page._markdown);

  let viewToUse;

  if (typeof page.view === "string") {
    viewToUse = page.view;
  } else if (typeof config.defaultView === "string") {
    viewToUse = config.defaultView;
  } else {
    throw new Error(`No EJS template found for ${page._file}!`);
  }

  let viewPath = [config.viewPagePath] ?? ["views", "pages"];

  if (!fs.existsSync(path.join(...viewPath, `${viewToUse}.ejs`))) {
    throw new Error(`The EJS Template specified in ${page._file} of ${viewToUse} cannot be found!`);
  }

  const builtPage = await ejs.renderFile(
    path.join(...viewPath, `${viewToUse}.ejs`),
    { ...page, content: html }
  );

  return builtPage;
}

function getTimeToRead(content) {
  // This is a rather simplistic view at attempting to determine the average time
  // it will take someone to read a page.

  // First we will determine a word count.
  let wordCount = content.trim().split(/\s+/).length;
  let minutes = wordCount / 200; // The average adult reads 238 wpm, so lets go on the low end

  return Math.round(minutes);
}

main();
