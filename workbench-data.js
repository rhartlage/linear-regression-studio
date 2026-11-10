(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RegressionData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function parse(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Paste a header row and at least two data rows.');
    if (text.length > 3_000_000) throw new Error('This table is too large. Use a file smaller than 3 MB.');
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    const first = text.split('\n')[0];
    const outside = first.replace(/"(?:[^"]|"")*"/g, '');
    const delimiter = ['\t', ',', ';'].sort((a,b) => outside.split(b).length - outside.split(a).length)[0];
    const records = []; let cells = [], cell = '', quoted = false, afterQuote = false, line = 1, startLine = 1;
    function finishCell() { cells.push(cell.trim()); cell = ''; afterQuote = false; }
    function finishRow() { finishCell(); if (cells.some(v => v !== '')) records.push({cells, line:startLine}); cells = []; startLine = line + 1; }
    for (let i=0; i<text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i+1] === '"') { cell += '"'; i++; }
        else if (ch === '"') { quoted = false; afterQuote = true; }
        else { cell += ch; if (ch === '\n') line++; }
      } else if (ch === delimiter) finishCell();
      else if (ch === '\n') { finishRow(); line++; }
      else if (ch === '"' && cell.trim() === '' && !afterQuote) { quoted = true; cell = ''; }
      else if (afterQuote && ch.trim()) throw new Error(`Unexpected text after a closing quote near line ${line}.`);
      else if (!afterQuote) cell += ch;
    }
    if (quoted) throw new Error('A quoted field is not closed. Check the CSV quotation marks.');
    if (cell || cells.length) finishRow();
    if (records.length < 3) throw new Error('Include a header row and at least two data rows.');
    const headers = records[0].cells;
    if (headers.length < 2 || headers.length > 20) throw new Error('Use between 2 and 20 columns.');
    if (headers.some(h => !h || h.length > 80)) throw new Error('Every column needs a name of 1–80 characters.');
    if (new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error('Column names must be unique.');
    if (records.length > 5001) throw new Error('Use no more than 5,000 data rows.');
    let missing = 0, nonnumeric = 0;
    const rowNumbers = [];
    const rows = records.slice(1).map(record => {
      if (record.cells.length !== headers.length) throw new Error(`Line ${record.line} has ${record.cells.length} columns; the header has ${headers.length}.`);
      rowNumbers.push(record.line);
      return record.cells.map(value => {
        if (!value) { missing++; return null; }
        if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) { nonnumeric++; return null; }
        return Number(value);
      });
    });
    return {headers,rows,rowNumbers,missing,nonnumeric};
  }
  function csv(data) {
    const quote = value => '"' + String(value).replace(/"/g,'""') + '"';
    // Prefix formula-like header labels for spreadsheet safety; numeric observations remain numeric.
    const safeHeader = h => /^[=+\-@\t\r]/.test(h) ? "'" + h : h;
    return data.headers.map(h => quote(safeHeader(h))).join(',') + '\r\n' + data.rows.map(r=>r.map(v=>v == null ? '' : String(v)).join(',')).join('\r\n');
  }
  function example(name) {
    let seed=2150;
    const random = () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return (seed+.5)/4294967296; };
    const normal = () => Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
    let headers, description; const rows=[];
    for (let i=0; i<96; i++) {
      const a=5+25*random(), p=7+5*random(), f=80+160*random(), noise=normal();
      if (name==='advertising') { headers=['Sales','Advertising']; rows.push([40+3.2*a+9*noise,a]); description='Synthetic sales ($ thousands) and advertising spend ($ thousands). Fit a line, compare an external equation, then inspect the residuals.'; }
      else if (name==='interaction') { headers=['Sales','Advertising','Price']; rows.push([100+3*(a-17.5)-8*(p-9.5)-1.7*(a-17.5)*(p-9.5)+8*noise,a,p]); description='Synthetic sales, advertising, and price. Does advertising have the same effect at every price? Enable two-way interactions and compare model slices at different prices.'; }
      else if (name==='curvature') { headers=['Defects','Speed','Temperature']; rows.push([35+.05*(f-160)**2+0.8*(a-17.5)+5*noise,f,a]); description='Synthetic process data. Defects curve with production speed. A straight-line term can miss this pattern; compare adding Speed² and inspect the residuals.'; }
      else if (name==='threeway') { headers=['Output','A','B','C']; const b=(p-9.5)/2.5,c=(f-160)/80,x=(a-17.5)/12.5; rows.push([50+3*x+2*b-2*c+4*x*b+3*x*c-3*b*c+18*x*b*c+2*noise,x,b,c]); description='Synthetic three-factor process. The effect of A depends jointly on B and C. Enable three-way terms and retain their component effects.'; }
      else { headers=['Sales','Advertising','Price','FootTraffic','DisplayScore']; const d=random()*100; rows.push([80+2.2*a-9*p+.65*f+10*noise,a,p,f,d]); description='Synthetic store data. Sales ($ thousands), advertising ($ thousands), price ($), foot traffic, and a display score. Which predictors add useful information after the others are included?'; }
    }
    return {headers,rows:rows.map(r=>r.map(v=>Number(v.toFixed(6)))),rowNumbers:rows.map((_,i)=>i+2),missing:0,nonnumeric:0,description};
  }
  return {parse,csv,example};
});
