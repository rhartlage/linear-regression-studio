(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/xlsx.full.min.js'),require('./workbench-data.js'));
  else root.RegressionWorkbook=factory(root.XLSX,root.RegressionData);
})(typeof globalThis!=='undefined'?globalThis:this,function(XLSX,D){
  'use strict';
  function read(bytes){return XLSX.read(bytes,{type:'array',cellDates:true,cellFormula:false,sheetRows:5002});}
  function table(book,sheet,range){
    if(!book.Sheets[sheet])throw new Error('Choose a worksheet.');
    range=range.trim().toUpperCase();
    if(!/^[A-Z]{1,3}[1-9]\d*:[A-Z]{1,3}[1-9]\d*$/.test(range))throw new Error('Enter a rectangular range including headers, such as A1:C13.');
    const r=XLSX.utils.decode_range(range),height=r.e.r-r.s.r+1,width=r.e.c-r.s.c+1;
    if(height<3||height>5001||width<2||width>20||r.e.r>=5002||r.e.c>=16384)throw new Error('Choose 2–20 columns and a header plus 2–5,000 data rows within the first 5,002 worksheet rows.');
    const rows=[],numbers=[];
    for(let i=r.s.r;i<=r.e.r;i++){
      const row=[];
      for(let j=r.s.c;j<=r.e.c;j++){
        const cell=book.Sheets[sheet][XLSX.utils.encode_cell({r:i,c:j})];
        if(cell&&(cell.t==='d'||cell.t==='e'||cell.t==='b'))throw new Error(`Cell ${XLSX.utils.encode_cell({r:i,c:j})} is a date, error, or Boolean. Use numeric observations, not dates or error values.`);
        row.push(cell?.v==null?'':String(cell.v));
      }
      if(i===r.s.r||row.some(v=>v.trim())){rows.push(row);if(i!==r.s.r)numbers.push(i+1);}
    }
    const data=D.parse(rows.map(row=>row.map(v=>'"'+v.replace(/"/g,'""')+'"').join(',')).join('\n'));
    data.rowNumbers=numbers;return data;
  }
  return {read,table};
});
