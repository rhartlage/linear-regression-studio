import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
const {chromium}=await import(process.env.REGRESSION_PLAYWRIGHT_MODULE || 'playwright');
let browser,server,base;
before(async()=>{
  if(process.env.REGRESSION_TEST_URL) base=process.env.REGRESSION_TEST_URL;
  else { const root=new URL(process.env.REGRESSION_TEST_ROOT||'./',import.meta.url);server=createServer(async(req,res)=>{try{let path=new URL(req.url,'http://localhost').pathname;if(path.endsWith('/'))path+='index.html';if(path.includes('..'))throw new Error('invalid');const content=await readFile(new URL('.'+path,root));res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(content);}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}${process.env.REGRESSION_TEST_PATH||'/'}`;}
  browser=await chromium.launch({headless:true,...(process.env.REGRESSION_CHROMIUM_PATH?{executablePath:process.env.REGRESSION_CHROMIUM_PATH}:{})});
});
after(async()=>{await browser?.close();if(server)await new Promise(r=>server.close(r));});
async function open(width=1440){const page=await browser.newPage({viewport:{width,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));page.errors=errors;await page.goto(base);await page.locator('#wbCoefficients tbody tr').first().waitFor();return page;}
const state=page=>page.evaluate(()=>RegressionWorkbench.getState());
async function example(page,name){await page.selectOption('#wbExample',name);await page.click('#wbLoadExample');}
async function paste(page,text){await page.locator('#wbImportDetails').evaluate(n=>n.open=true);await page.fill('#wbPaste',text);await page.click('#wbImport');}

test('default model loads without script errors or external requests; every plot has an accessible name',async()=>{
  const page=await browser.newPage();const requests=[];page.on('request',r=>requests.push(r.url()));const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  assert.equal((await state(page)).n,96);assert.equal((await state(page)).included.length,4);assert.equal(await page.locator('#wbCoefficients tbody tr').count(),5);
  assert.deepEqual(errors,[]);assert.ok(requests.every(url=>new URL(url).origin===new URL(base).origin));
  const graphs=await page.locator('#modelStudio svg').evaluateAll(nodes=>nodes.map(n=>({role:n.getAttribute('role'),label:n.getAttribute('aria-label')||document.getElementById(n.getAttribute('aria-labelledby'))?.textContent,desc:document.getElementById(n.getAttribute('aria-describedby'))?.textContent})));
  assert.ok(graphs.every(g=>g.role==='img'&&g.label&&g.desc));assert.equal(await page.evaluate(()=>localStorage.length),0);await page.close();
});
test('forward/backward steps refit ANOVA and all statistics; undo preserves model history',async()=>{
  const page=await open();const full=await state(page);await page.click('#wbStartEmpty');let s=await state(page);assert.equal(s.included.length,0);assert.equal(s.fit.dfRegression,0);
  const initial=s.fit.sse;await page.getByRole('button',{name:'Add Advertising',exact:true}).click();s=await state(page);assert.deepEqual(s.included,['0']);assert.ok(s.fit.sse<initial);assert.equal(s.fit.dfError,94);
  await page.click('#wbSuggest');assert.ok((await page.locator('#wbSuggestion').innerText()).length>40);await page.click('#wbUndo');assert.equal((await state(page)).included.length,0);
  await page.click('#wbStartFull');s=await state(page);assert.ok(Math.abs(s.fit.sse-full.fit.sse)<1e-8);await page.click('#wbSuggest');assert.match(await page.locator('#wbSuggestion').innerText(),/DisplayScore/);await page.getByRole('button',{name:'Remove DisplayScore',exact:true}).click();s=await state(page);assert.equal(s.included.length,3);assert.equal(s.fit.dfError,92);assert.doesNotMatch(await page.locator('#wbSuggestion').innerText(),/Consider removing DisplayScore/);assert.equal(await page.evaluate(()=>document.activeElement.id),'wbStatus');assert.equal(await page.locator('#wbAnova tbody tr').count(),3);assert.deepEqual(page.errors,[]);await page.close();
});
test('two-way, three-way and square hierarchy preserves parents and uses grouped forward tests',async()=>{
  const page=await open();await example(page,'threeway');await page.locator('.wb-term-options summary').click();await page.check('#wbTriples');await page.click('#wbRebuildTerms');await page.click('#wbStartEmpty');
  await page.getByRole('button',{name:'Add A × B × C',exact:true}).click();let s=await state(page);assert.equal(s.included.length,7);assert.ok(await page.getByRole('button',{name:'Remove A',exact:true}).isDisabled());assert.ok(await page.getByRole('button',{name:'Remove A × B',exact:true}).isDisabled());
  await page.getByRole('button',{name:'Remove A × B × C',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Remove A × B',exact:true}).isEnabled());
  await example(page,'curvature');await page.check('#wbSquares');await page.click('#wbRebuildTerms');const beforeFit=(await state(page)).fit;await page.getByRole('button',{name:'Add Speed²',exact:true}).click();s=await state(page);assert.ok(s.fit.sse<beforeFit.sse*.1);assert.ok(await page.getByRole('button',{name:'Remove Speed',exact:true}).isDisabled());
  assert.ok(s.tornado.find(r=>r.name==='Speed').turn!==null);assert.deepEqual(page.errors,[]);await page.close();
});
test('local paste accepts real units and missing rows; row set stays fixed during selection',async()=>{
  const page=await open();await paste(page,'Revenue,Spend,Price\n1000,-50,2\n1120,10,3\n1190,50,\n1250,80,5\n1400,150,4\n1310,100,6');let s=await state(page);assert.equal(s.n,5);assert.match(await page.locator('#wbRowsNote').innerText(),/Excluded source rows 4/);await page.click('#wbStartEmpty');assert.equal((await state(page)).n,5);
  await page.getByRole('button',{name:'Add Spend',exact:true}).click();assert.equal((await state(page)).n,5);assert.equal(await page.locator('#wbSlice circle').count(),5);
  const rev=(await state(page)).revision;await paste(page,'Revenue,Spend\n1,2\n3');assert.equal((await state(page)).revision,rev);assert.match(await page.locator('#wbImportStatus').innerText(),/not applied/);assert.deepEqual(page.errors,[]);await page.close();
});
test('local file import, invalid columns and malicious labels cannot silently keep stale results',async()=>{
  const page=await open();await page.locator('#wbImportDetails').evaluate(n=>n.open=true);await page.setInputFiles('#wbFile',{name:'sample.csv',mimeType:'text/csv',buffer:Buffer.from('Outcome,<img src=x onerror=alert(1)>\n3,1\n5,2\n8,3\n9,4\n12,5')});await page.waitForFunction(()=>RegressionWorkbench.getState().n===5);assert.equal(await page.locator('#modelStudio img').count(),0);
  await paste(page,'Name,Y,X\nAlice,2,1\nBob,5,2\nCarol,7,3\nDave,10,4');assert.equal(await page.locator('.wb-grid').isVisible(),false);assert.equal((await state(page)).fit,null);
  await page.selectOption('#wbResponse','1');await page.locator('#wbPredictors input[value="0"]').uncheck();await page.locator('#wbPredictors input[value="2"]').check();await page.click('#wbApplyVariables');assert.equal((await state(page)).n,4);assert.equal(await page.locator('.wb-grid').isVisible(),true);assert.deepEqual(page.errors,[]);await page.close();
});
test('collinear and saturated proposals are explicit and do not fabricate inference',async()=>{
  const page=await open();await paste(page,'Y,A,B\n3,1,2\n5,2,4\n6,3,6\n9,4,8\n12,5,10');assert.equal((await state(page)).included.length,0);await page.getByRole('button',{name:'Add A',exact:true}).click();assert.ok(await page.getByRole('button',{name:'Add B',exact:true}).isDisabled());
  await paste(page,'Y,X\n4,1\n7,2');let s=await state(page);assert.equal(s.fit.dfError,0);assert.equal(s.fit.p,null);assert.match(await page.locator('#wbWarnings').innerText(),/degrees of freedom/i);
  await paste(page,'Y,X\n4,1\n4,2\n4,3\n4,4');s=await state(page);assert.equal(s.fit.r2,null);assert.equal(s.fit.p,null);assert.deepEqual(page.errors,[]);await page.close();
});
test('unrepresentable imported response variation never shows stale model results',async()=>{
  const page=await open();await paste(page,'Y,X\n1.7e308,1\n1.7e308,2\n-1.7e308,3');assert.equal((await state(page)).fit.ok,false);assert.equal(await page.locator('.wb-grid').isVisible(),false);assert.equal(await page.locator('#wbPredictionSection').isVisible(),false);assert.equal(await page.locator('#wbDiagnosticSection').isVisible(),false);assert.match(await page.locator('#wbRowsNote').innerText(),/No model can be displayed/);assert.deepEqual(page.errors,[]);await page.close();
});
test('fresh examples reset predictor choices and extreme finite axis ranges stay finite',async()=>{
  const page=await open();await example(page,'advertising');assert.equal((await state(page)).names.length,1);await example(page,'sales');assert.equal((await state(page)).names.length,4);await example(page,'interaction');assert.deepEqual((await state(page)).names,['Advertising','Price']);
  await paste(page,'Y,X\n-2,-1e308\n-0.9,-5e307\n0.1,0\n1,5e307\n2.1,1e308');assert.equal((await state(page)).fit.ok,true);const invalid=await page.locator('#modelStudio svg').evaluateAll(nodes=>nodes.flatMap(svg=>[...svg.querySelectorAll('*')].flatMap(n=>[...n.attributes].filter(a=>/NaN|Infinity/.test(a.value)).map(a=>a.name+'='+a.value))));assert.deepEqual(invalid,[]);assert.deepEqual(page.errors,[]);await page.close();
});
test('prediction reference settings and external line change visuals but never fitted inference',async()=>{
  const page=await open();const f=(await state(page)).fit;await page.fill('#wbReference0','999');assert.match(await page.locator('#wbPrediction').innerText(),/Extrapolation warning/);assert.equal((await state(page)).fit.sse,f.sse);await page.fill('#wbReference0','');await page.selectOption('#wbPlotX','1');assert.match(await page.locator('#wbPrediction').innerText(),/last valid settings/);await page.getByRole('button',{name:'Remove DisplayScore',exact:true}).click();assert.match(await page.locator('#wbPrediction').innerText(),/last valid settings/);
  await example(page,'advertising');const single=(await state(page)).fit;await page.locator('details').filter({has:page.locator('#wbOverlay')}).evaluate(n=>n.open=true);await page.fill('#wbOverlaySlope','-5');await page.fill('#wbOverlayIntercept','500');await page.check('#wbOverlay');assert.match(await page.locator('#wbOverlayNote').innerText(),/Purple dashed/);assert.equal((await state(page)).fit.sse,single.sse);assert.equal(await page.locator('#wbSlice path[stroke="#8e438f"]').count(),1);await page.fill('#wbOverlaySlope','');assert.match(await page.locator('#wbOverlayNote').innerText(),/No comparison line/);assert.equal(await page.locator('#wbSlice path[stroke="#8e438f"]').count(),0);await page.fill('#wbReference0','1e308');assert.match(await page.locator('#wbPrediction').innerText(),/beyond the supported numeric range/);assert.deepEqual(page.errors,[]);await page.close();
});
test('legacy line playground, keyboard controls, seeds and comparison line keep OLS inference fixed',async()=>{
  const page=await open();await page.click('#playgroundMode');assert.equal(await page.locator('#studio').isVisible(),true);const before=await page.locator('#anovaTableBody').innerText();await page.fill('#lineSlope','0.1');await page.fill('#lineIntercept','50');await page.click('#applyLineBtn');assert.equal(await page.locator('#anovaTableBody').innerText(),before);assert.match(await page.locator('#equationText').innerText(),/0.1/);
  await page.click('#snapBestFitBtn');await page.fill('#pointX','20');await page.fill('#pointY','30');await page.click('#addPointBtn');assert.notEqual(await page.locator('#anovaTableBody').innerText(),before);await page.click('#undoBtn');await page.click('#rerunSeedBtn');assert.equal(await page.locator('#anovaTableBody').innerText(),before);
  assert.ok(await page.locator('#simpleQQ circle').count()>0);await page.click('#clearBtn');assert.equal(await page.locator('#simpleQQ circle').count(),0);assert.deepEqual(page.errors,[]);await page.close();
});
test('desktop and mobile have no page overflow; keyboard activation and repeated switching work',async()=>{
  for(const width of [1440,1024,768,390,320]){const page=await open(width);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);await page.locator('#playgroundMode').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#studio').isVisible(),true);await page.locator('#builderMode').focus();await page.keyboard.press('Space');assert.equal(await page.locator('#modelStudio').isVisible(),true);await page.click('#playgroundMode');await page.click('#builderMode');assert.equal((await state(page)).n,96);if(process.env.REGRESSION_SCREENSHOT_DIR&&[1440,390].includes(width)){await mkdir(process.env.REGRESSION_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:`${process.env.REGRESSION_SCREENSHOT_DIR}/regression-${width}.png`,fullPage:true});}assert.deepEqual(page.errors,[]);await page.close();}
});
