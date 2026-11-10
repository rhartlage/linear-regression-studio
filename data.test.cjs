const test=require('node:test');const assert=require('node:assert/strict');const D=require('./workbench-data.js');
test('CSV, TSV, semicolon, BOM, negatives and scientific notation parse without coercing missing values',()=>{
  for(const sep of [',','\t',';']){const d=D.parse('\uFEFFY'+sep+'X\r\n-2.5'+sep+'1e2\r\n0'+sep+'\r\n3'+sep+'4');assert.deepEqual(d.rows,[[-2.5,100],[0,null],[3,4]]);assert.equal(d.missing,1);}
});
test('quoted separators, escaped quotes, final newline and nonnumeric fields are explicit',()=>{const d=D.parse('"Sales, USD","A ""score"""\n1,2\n3,abc\n');assert.deepEqual(d.headers,['Sales, USD','A "score"']);assert.equal(d.nonnumeric,1);assert.equal(d.rows[1][1],null);});
test('malformed input is rejected rather than partly applied',()=>{for(const s of ['Y,X\n1,2\n3','Y,y\n1,2\n3,4','Y,X\n"1,2\n3,4','Y,X\n"1"bad,2\n3,4','Y,X\n1,2'])assert.throws(()=>D.parse(s));});
test('export protects formula headers and never executes text',()=>{const csv=D.csv({headers:['=HYPERLINK("bad")','X'],rows:[[1,2]]});assert.ok(csv.startsWith('"\'=HYPERLINK'));assert.ok(csv.endsWith('1,2'));});
test('classroom data are seeded, finite and adequately sized',()=>{for(const n of ['sales','advertising','interaction','curvature','threeway']){const a=D.example(n),b=D.example(n);assert.deepEqual(a,b);assert.equal(a.rows.length,96);assert.ok(a.rows.every(r=>r.every(Number.isFinite)));}});
