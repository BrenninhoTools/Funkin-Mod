/* Test runner: node tests/run.js
 *   WRITE_FIXTURE=a.zip WRITE_FIXTURE_CN=b.zip node tests/run.js   saves the fake mods (used for UI tests)
 *   HAXE_BIN=... HX_PARSER_CP=... node tests/run.js                  also parses generated .hxc files (tests/hscript/README.md) */
const suites = ['lua.test.js', 'psych.test.js', 'codename.test.js', 'diff.test.js'];

(async () => {
  let failed = 0;
  for (const name of suites) {
    const notes = [];
    try {
      await require('./' + name).run({ note: (m) => notes.push(m) });
      console.log('PASS ' + name);
      notes.forEach((n) => console.log('     - ' + n));
    } catch (e) {
      failed++;
      console.log('FAIL ' + name);
      console.log(e && e.stack ? e.stack : e);
    }
  }
  console.log(failed ? '\n' + failed + ' suite(s) failed.' : '\nAll suites passed.');
  process.exit(failed ? 1 : 0);
})();
