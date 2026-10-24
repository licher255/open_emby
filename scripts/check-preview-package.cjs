// Run with Electron so fs can inspect the packaged ASAR without extracting it.
const { app } = require('electron')
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..'), pkg = path.join(root, 'dist/four-choice/win-unpacked/resources/app.asar')
app.whenReady().then(() => {
  try {
    const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'))).version
    assert.equal(version, '0.0.3-beta')
    const checkTree = relative => {
      for (const name of fs.readdirSync(path.join(root, relative))) {
        const file = path.join(relative, name)
        if (fs.statSync(path.join(root, file)).isDirectory()) checkTree(file)
        else assert.deepEqual(fs.readFileSync(path.join(root, file)), fs.readFileSync(path.join(pkg, file)), file)
      }
    }
    checkTree('out')
    fs.writeFileSync(path.resolve(root, '../doc/four-choice-tests/package-result.json'), JSON.stringify({ passed: true, version, allCompiledFilesMatch: true }, null, 2))
    console.log('PASS packaged 0.0.3-beta matches all tested compiled files.'); app.exit(0)
  } catch (error) { console.error(error); app.exit(1) }
})
