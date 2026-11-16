const test=require('node:test'),assert=require('node:assert/strict');
const X=require('./vendor/xlsx.full.min.js'),W=require('./workbook-data.js');
function book(rows){const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(rows),'Data');return W.read(X.write(b,{type:'buffer',bookType:'xlsx'}));}
test('xlsx selection reads numeric cells, quoted headers, and source row numbers',()=>{
 const b=book([['Notes'],[],['x,label','Response'],[1,3],[2,5],[],[3,8]]);
 const d=W.table(b,'Data','a3:b7');assert.deepEqual(d.headers,['x,label','Response']);assert.deepEqual(d.rows,[[1,3],[2,5],[3,8]]);assert.deepEqual(d.rowNumbers,[4,5,7]);
});
test('xlsx invalid ranges and invalid headers are rejected',()=>{
 const b=book([['x','y'],[1,2],[2,4]]);
 for(const r of ['A1','A1:ZZ999999','B3:A1','A1:B5003','A1:U3'])assert.throws(()=>W.table(b,'Data',r));
 assert.throws(()=>W.table(b,'Other','A1:B3'));
 assert.throws(()=>W.table(book([['x','X'],[1,2],[2,4]]),'Data','A1:B3'));
});
test('xlsx missing/nonnumeric observations retain existing explicit exclusion rules',()=>{
 const d=W.table(book([['x','y'],[1,'text'],[2,null],[3,8]]),'Data','A1:B4');assert.equal(d.missing,1);assert.equal(d.nonnumeric,1);assert.deepEqual(d.rows,[[1,null],[2,null],[3,8]]);
});
test('xlsx dates, Boolean values and Excel errors are rejected',()=>{
 for(const v of [new Date(2020,0,1),true])assert.throws(()=>W.table(book([['x','y'],[1,v],[2,4]]),'Data','A1:B3'));
 const b=book([['x','y'],[1,2],[2,4]]);b.Sheets.Data.B2={t:'e',v:7};assert.throws(()=>W.table(b,'Data','A1:B3'));
});
