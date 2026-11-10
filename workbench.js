/* Teaching UI. All input data and model changes stay in memory on this device. */
(function () {
  'use strict';
  const M = window.RegressionMath, D = window.RegressionData;
  const $ = id => document.getElementById(id);
  const state = { data:null, response:0, predictors:[], names:[], X:[], y:[], rowIds:[], candidates:[], included:[], fit:null, cache:new Map(), history:[], references:[], referenceWarning:'', revision:0 };
  const key = term => term.join(':');
  const sortTerms = terms => terms.slice().sort((a,b)=>a.length-b.length || key(a).localeCompare(key(b),undefined,{numeric:true}));
  const same = (a,b) => key(a) === key(b);
  function fmt(value, digits=4) {
    if (value === Infinity) return '∞';
    if (value === -Infinity) return '−∞';
    if (!Number.isFinite(value)) return '—';
    if (value !== 0 && (Math.abs(value)<0.0001 || Math.abs(value)>=1e7)) return value.toExponential(3);
    return Number(value.toFixed(digits)).toLocaleString('en-US',{maximumFractionDigits:digits});
  }
  const pformat = p => !Number.isFinite(p) ? '—' : p < .0001 ? '<0.0001' : p.toFixed(4);
  const numberInput = value => Number.isFinite(value) ? Number(value.toPrecision(12)).toString() : '';
  function el(tag,text,attrs={}) { const node=document.createElement(tag); if(text != null) node.textContent=text; Object.entries(attrs).forEach(([k,v])=>node.setAttribute(k,v)); return node; }
  function status(message,error=false) { $('wbStatus').textContent=message; $('wbStatus').classList.toggle('error',error); }
  function table(id,headers,rows) {
    const node=$(id); node.replaceChildren();
    const head=el('thead'), tr=el('tr'); headers.forEach(h=>tr.append(el('th',h,{scope:'col'}))); head.append(tr); node.append(head);
    const body=el('tbody');
    for(const cells of rows) { const r=el('tr'); cells.forEach((v,i)=>r.append(el(i===0?'th':'td',v,{...(i===0?{scope:'row'}:{})}))); body.append(r); }
    node.append(body);
  }
  function termLabel(term,centered=false) {
    const names=state.names.map(name=>centered ? `${name}ᶜ` : name);
    if(term.length===2 && term[0]===term[1]) return `${names[term[0]]}²`;
    return term.map(i=>names[i]).join(' × ');
  }
  function contains(big,small) { const copy=big.slice(); for(const i of small) { const pos=copy.indexOf(i); if(pos<0) return false; copy.splice(pos,1); } return true; }
  function closure(terms) {
    const all=new Map();
    for(const term of terms) {
      for(let bits=1; bits<2**term.length; bits++) { const t=term.filter((_,j)=>bits & 2**j); all.set(key(t),t); }
    }
    return sortTerms([...all.values()]);
  }
  function fitTerms(terms) {
    const ordered=sortTerms(terms), id=ordered.map(key).join('|');
    if(!state.cache.has(id)) state.cache.set(id,M.fit(state.X,state.y,ordered,{center:true}));
    return state.cache.get(id);
  }
  function generateCandidates() {
    const p=state.names.length, squares=$('wbSquares').checked, pairs=$('wbPairs').checked, triples=$('wbTriples').checked;
    if(p>6 && (squares||pairs||triples)) throw new Error('For higher-order terms, select no more than six candidate predictors.');
    const terms=[];
    for(let a=0;a<p;a++) {
      terms.push([a]); if(squares) terms.push([a,a]);
      for(let b=a+1;b<p;b++) { if(pairs||triples) terms.push([a,b]); for(let c=b+1;c<p;c++) if(triples) terms.push([a,b,c]); }
    }
    if(terms.length>40) throw new Error(`These options create ${terms.length} terms. Keep at most 40; reduce predictors or turn off a term family.`);
    if(triples) $('wbPairs').checked=true;
    return sortTerms(terms);
  }
  function snapshot(message) {
    return {message,included:state.included.map(t=>t.slice()),candidates:state.candidates.map(t=>t.slice()),flags:['wbSquares','wbPairs','wbTriples'].map(id=>$(id).checked),fit:state.fit};
  }
  function changeModel(terms,message) {
    const next=sortTerms(terms), fit=fitTerms(next);
    if(!fit.ok) { status(`Cannot make that change: ${fit.error} The previous model is unchanged.`,true); return false; }
    state.included=next; state.fit=fit; state.history.push(snapshot(message));
    if(state.history.length>101) state.history.shift();
    state.revision++; renderModel(message); return true;
  }
  function clearTables() {
    ['wbCoefficients','wbAnova','wbHistory','wbTornadoTable','wbObservations'].forEach(id=>$(id).replaceChildren());
  }
  function loadData(data,description) {
    state.data=data;
    state.fit=null;state.history=[];state.cache.clear();
    document.querySelector('.wb-grid').hidden=true;$('wbPredictionSection').hidden=true;$('wbDiagnosticSection').hidden=true;
    $('wbDataDescription').textContent=description || data.description || 'Imported numeric dataset. Choose the response and candidate predictors below.';
    $('wbRowCount').textContent=`(${data.rows.length} rows)`;
    table('wbPreview',['Source row',...data.headers],data.rows.slice(0,12).map((r,i)=>[String(data.rowNumbers[i]),...r.map(v=>v===null?'Missing / non-numeric':fmt(v))]));
    $('wbResponse').replaceChildren(...data.headers.map((name,i)=>el('option',name,{value:i})));
    $('wbResponse').value='0';
    $('wbPredictors').replaceChildren();
    makePredictorOptions();
    ['wbSquares','wbPairs','wbTriples'].forEach(id=>$(id).checked=false);
    $('wbOverlay').checked=false;
    $('wbSuggestion').textContent='You choose the model. A threshold is a guide, not a substitute for the research question.';
    applyVariables();
  }
  function makePredictorOptions() {
    const response=Number($('wbResponse').value), old=new Set([...$('wbPredictors').querySelectorAll('input:checked')].map(n=>Number(n.value)));
    $('wbPredictors').replaceChildren();
    state.data.headers.forEach((name,i)=>{
      if(i===response) return;
      const label=el('label'), input=el('input',null,{type:'checkbox',value:i});
      input.checked=old.size ? old.has(i) : i<5;
      input.addEventListener('change',markVariablesPending); label.append(input,document.createTextNode(name)); $('wbPredictors').append(label);
    });
  }
  function markVariablesPending() { $('wbRowsNote').textContent='Variable choices are not applied yet. Select “Use these variables” to start a new model history.'; }
  function applyVariables() {
    const response=Number($('wbResponse').value), predictors=[...$('wbPredictors').querySelectorAll('input:checked')].map(n=>Number(n.value));
    if(!predictors.length || predictors.length>8) { $('wbRowsNote').textContent='Select between one and eight candidate predictors.'; return false; }
    const selected=[response,...predictors], valid=[], skipped=[];
    state.data.rows.forEach((r,i)=>(selected.every(j=>Number.isFinite(r[j]))?valid:skipped).push(i));
    if(valid.length<2) { $('wbRowsNote').textContent=`Only ${valid.length} complete numeric rows for these variables. Choose other columns or repair the data. At least two are needed.`; return false; }
    state.response=response; state.predictors=predictors; state.names=predictors.map(j=>state.data.headers[j]);
    state.X=valid.map(i=>predictors.map(j=>state.data.rows[i][j])); state.y=valid.map(i=>state.data.rows[i][response]); state.rowIds=valid.map(i=>state.data.rowNumbers[i]);
    state.cache.clear(); state.history=[];
    $('wbRowsNote').textContent=`Using ${valid.length} of ${state.data.rows.length} rows. ${skipped.length ? `Excluded source rows ${skipped.slice(0,12).map(i=>state.data.rowNumbers[i]).join(', ')}${skipped.length>12?'…':''} because a selected column is missing or non-numeric. ` : ''}The same rows stay fixed through every term change, including an intercept-only model.`;
    if(state.names.length>6) ['wbSquares','wbPairs','wbTriples'].forEach(id=>$(id).checked=false);
    try { state.candidates=generateCandidates(); } catch(err) { ['wbSquares','wbPairs','wbTriples'].forEach(id=>$(id).checked=false); state.candidates=generateCandidates(); }
    state.included=state.names.map((_,i)=>[i]);
    state.fit=fitTerms(state.included);
    let message='Started with all main effects.';
    if(!state.fit.ok) { const reason=state.fit.error; state.included=[]; state.fit=fitTerms([]); message=`Main-effects model could not be estimated (${reason}). Started with the intercept only; add estimable terms below.`; }
    if(!state.fit.ok) {
      clearTables();document.querySelector('.wb-grid').hidden=true;$('wbPredictionSection').hidden=true;$('wbDiagnosticSection').hidden=true;
      $('wbRowsNote').textContent+=` No model can be displayed: ${state.fit.error}. Rescale the data or choose different variables.`;
      return false;
    }
    state.references=state.names.map((_,j)=>state.X.reduce((sum,r)=>sum+r[j]/state.X.length,0));
    state.referenceWarning='';
    document.querySelector('.wb-grid').hidden=false;$('wbPredictionSection').hidden=false;$('wbDiagnosticSection').hidden=false;
    $('wbPlotX').replaceChildren(...state.names.map((n,i)=>el('option',n,{value:i})));
    $('wbReferenceInputs').replaceChildren(...state.names.map((name,i)=>{
      const label=el('label'), input=el('input',null,{type:'number',step:'any',id:`wbReference${i}`,value:numberInput(state.references[i])});
      label.append(el('span',`${name} reference`),input); input.addEventListener('input',()=>updateReferences()); return label;
    }));
    clearTables(); state.history.push(snapshot(message)); state.revision++; renderModel(message); return true;
  }
  function updateReferences() {
    const values=state.names.map((_,i)=>{ const s=$(`wbReference${i}`).value.trim(); return s===''?NaN:Number(s); });
    if(values.some(v=>!Number.isFinite(v))) { state.referenceWarning='Enter a finite number for every reference setting. Plots retain the last valid settings.';renderPredictions();return; }
    if(!Number.isFinite(M.predict(state.fit,values))) { state.referenceWarning='These settings produce a prediction beyond the supported numeric range. Plots retain the last valid settings; use smaller values.';renderPredictions();return; }
    state.references=values;state.referenceWarning='';renderPredictions();
  }
  function renderTerms() {
    const included=$('wbIncluded'),available=$('wbAvailable'); included.replaceChildren(); available.replaceChildren();
    const includedKeys=new Set(state.included.map(key));
    $('wbIncludedCount').textContent=`(${state.included.length})`;
    $('wbAvailableCount').textContent=`(${state.candidates.length-state.included.length})`;
    if(!state.included.length) included.append(el('p','Intercept only: every observation has the same fitted value.',{class:'support-text'}));
    state.included.forEach((term,i)=>{
      const dependents=state.included.filter(t=>t.length>term.length && contains(t,term));
      const node=el('div',null,{class:'wb-term'}), button=el('button','Remove',{type:'button','aria-label':`Remove ${termLabel(term)}`});
      button.disabled=!!dependents.length;
      node.append(el('strong',termLabel(term)),el('p',dependents.length ? `Retained for ${dependents.map(t=>termLabel(t)).join(', ')}.` : `t = ${fmt(state.fit.coefficients[i+1].t)}, p = ${pformat(state.fit.coefficients[i+1].p)}`),button);
      button.addEventListener('click',()=>{ if(changeModel(state.included.filter(t=>!same(t,term)),`Removed ${termLabel(term)}.`)) $('wbStatus').focus({preventScroll:true}); });
      included.append(node);
    });
    state.candidateResults=[];
    for(const term of state.candidates) {
      if(includedKeys.has(key(term))) continue;
      const proposed=closure([...state.included,term]),added=proposed.filter(t=>!includedKeys.has(key(t))),fit=fitTerms(proposed);
      const comparison=fit.ok ? M.partialF(state.fit,fit) : null;
      const p=comparison?.p ?? null;
      const node=el('div',null,{class:'wb-term'}), button=el('button','Add',{type:'button','aria-label':`Add ${termLabel(term)}`});
      button.disabled=!fit.ok;
      node.append(el('strong',termLabel(term)),el('p',!fit.ok ? fit.error : `${added.length>1?'Joint ':''}p = ${pformat(p)}${added.length>1?`; adds ${added.map(t=>termLabel(t)).join(', ')}`:''}${fit.dfError===0?'; no residual df':''}`),button);
      button.addEventListener('click',()=>{if(changeModel(proposed,`Added ${added.map(t=>termLabel(t)).join(', ')}.`))$('wbStatus').focus({preventScroll:true});}); available.append(node);
      state.candidateResults.push({term,proposed,added,fit,p});
    }
    if(available.children.length===0) available.append(el('p','All candidate terms are included. Enable another term family above to explore interactions or curvature.',{class:'support-text'}));
  }
  function coefficientRows(fit,labels) {
    return fit.coefficients.map((c,i)=>[labels[i],fmt(c.estimate),fmt(c.se),fmt(c.t),pformat(c.p),`[${fmt(c.ciLow)}, ${fmt(c.ciHigh)}]`,fmt(c.vif,2)]);
  }
  function renderModel(message) {
    const f=state.fit;
    if(!f?.ok) { status(f?.error||'Choose data to start.',true); return; }
    $('wbSuggestion').textContent='This model is current. Select “Suggest a next step” to evaluate the current terms and thresholds.';
    status(`${message} ${f.n} observations; ${f.k} fitted parameters including the intercept; ${f.dfError} residual degrees of freedom.`);
    $('wbUndo').disabled=state.history.length<2;
    $('wbMetrics').replaceChildren(...[['R²',fmt(f.r2)],['Adjusted R²',fmt(f.adjustedR2)],['Residual SE',fmt(f.residualSE)],['SSE',fmt(f.sse)],['Overall F',fmt(f.f)],['Model p',pformat(f.p)]].map(([name,value])=>{
      const dl=el('dl',null,{class:'wb-metric'}); dl.append(el('dt',name),el('dd',value)); return dl;
    }));
    const terms=f.coefficients.map((c,i)=>i===0?fmt(c.estimate):`${c.estimate<0?'−':'+'} ${fmt(Math.abs(c.estimate))} · ${termLabel(state.included[i-1],true)}`);
    $('wbEquation').textContent=`Predicted ${state.data.headers[state.response]} = ${terms.join(' ')}`;
    $('wbCentering').textContent=`Centered predictors: ${state.names.map((n,i)=>`${n}ᶜ = ${n} − (${fmt(f.means[i])})`).join('; ')}. Predictions are displayed in the original response units.`;
    const warningText=[...(f.warnings||[])];
    if(f.dfError>0 && f.dfError<10) warningText.push('Few residual degrees of freedom: estimates and diagnostics may be unstable.');
    const largeVif=f.coefficients.some(c=>Number.isFinite(c.vif)&&c.vif>5);
    if(largeVif) warningText.push('Some VIFs exceed 5. Investigate correlated predictors and unstable coefficient estimates; higher-order terms can also create collinearity.');
    $('wbWarnings').textContent=warningText.join(' ');
    table('wbCoefficients',['Term','Estimate','SE','t','p','95% CI','VIF'],coefficientRows(f,['Intercept',...state.included.map(t=>termLabel(t,true))]));
    table('wbAnova',['Source','SS','df','MS','F','p'],[
      ['Regression',fmt(f.ssr),String(f.dfRegression),fmt(f.dfRegression>0?f.ssr/f.dfRegression:null),fmt(f.f),pformat(f.p)],
      ['Error',fmt(f.sse),String(f.dfError),fmt(f.mse),'—','—'],['Total',fmt(f.sst),String(f.dfTotal),'—','—','—']
    ]);
    table('wbHistory',['Step','Decision','Terms','R²','Adjusted R²','Residual SE','ΔSSE'],state.history.map((h,i)=>[String(i),h.message,String(h.included.length),fmt(h.fit.r2),fmt(h.fit.adjustedR2),fmt(h.fit.residualSE),i?fmt(h.fit.sse-state.history[i-1].fit.sse):'—']));
    renderTerms(); renderPredictions(); renderDiagnostics();
  }
  function svgNode(root,tag,attrs,text) { const node=document.createElementNS('http://www.w3.org/2000/svg',tag); Object.entries(attrs||{}).forEach(([k,v])=>node.setAttribute(k,String(v))); if(text!=null) node.textContent=text; root.append(node); return node; }
  function extent(values) {
    let lo=Infinity,hi=-Infinity; for(const v of values) if(Number.isFinite(v)) { lo=Math.min(lo,v); hi=Math.max(hi,v); }
    if(!Number.isFinite(lo)) return [-1,1];
    if(lo===hi) { const d=Math.max(1,Math.abs(lo)*.05); return [Math.max(-Number.MAX_VALUE,lo-d),Math.min(Number.MAX_VALUE,hi+d)]; }
    const scale=Math.max(Math.abs(lo),Math.abs(hi)),pad=(hi/scale-lo/scale)*.09*scale;
    return [Math.max(-Number.MAX_VALUE,lo-pad),Math.min(Number.MAX_VALUE,hi+pad)];
  }
  function plot(id,{points=[],lines=[],xlabel='',ylabel='',xrange=null,yrange=null}) {
    const svg=$(id); svg.replaceChildren();
    const all=[...points,...lines.flatMap(line=>line.points)], xs=xrange||extent(all.map(p=>p.x)), ys=yrange||extent(all.map(p=>p.y));
    const left=82,right=618,top=20,bottom=285;
    const xscale=Math.max(Math.abs(xs[0]),Math.abs(xs[1]))||1,yscale=Math.max(Math.abs(ys[0]),Math.abs(ys[1]))||1;
    const x=v=>left+(v/xscale-xs[0]/xscale)/(xs[1]/xscale-xs[0]/xscale)*(right-left), y=v=>bottom-(v/yscale-ys[0]/yscale)/(ys[1]/yscale-ys[0]/yscale)*(bottom-top);
    for(let i=0;i<=4;i++) {
      const rawX=(1-i/4)*xs[0]+i/4*xs[1],rawY=(1-i/4)*ys[0]+i/4*ys[1];
      const xv=Math.abs(rawX/xscale)<(xs[1]/xscale-xs[0]/xscale)*1e-12?0:rawX,yv=Math.abs(rawY/yscale)<(ys[1]/yscale-ys[0]/yscale)*1e-12?0:rawY;
      svgNode(svg,'line',{x1:x(xv),x2:x(xv),y1:top,y2:bottom,stroke:'#e0e6e8'});
      svgNode(svg,'line',{x1:left,x2:right,y1:y(yv),y2:y(yv),stroke:'#e0e6e8'});
      svgNode(svg,'text',{x:x(xv),y:306,'text-anchor':'middle',fill:'#43556a','font-size':12},fmt(xv,2));
      svgNode(svg,'text',{x:left-8,y:y(yv)+4,'text-anchor':'end',fill:'#43556a','font-size':12},fmt(yv,2));
    }
    svgNode(svg,'path',{d:`M${left},${top} V${bottom} H${right}`,stroke:'#516276',fill:'none'});
    const defs=svgNode(svg,'defs',{}),clip=svgNode(defs,'clipPath',{id:`${id}-clip`}); svgNode(clip,'rect',{x:left,y:top,width:right-left,height:bottom-top});
    const group=svgNode(svg,'g',{'clip-path':`url(#${id}-clip)`});
    for(const line of lines) {
      const valid=line.points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
      if(valid.length>1) svgNode(group,'path',{d:valid.map((p,i)=>`${i?'L':'M'}${x(p.x)},${y(p.y)}`).join(' '),fill:'none',stroke:line.color||'#b16612','stroke-width':line.width||2.5,...(line.dash?{'stroke-dasharray':'7 5'}:{})});
    }
    for(const p of points) if(Number.isFinite(p.x)&&Number.isFinite(p.y)) { const circle=svgNode(group,'circle',{cx:x(p.x),cy:y(p.y),r:3.2,fill:p.color||'#236792',opacity:.7}); svgNode(circle,'title',{},p.label||`${xlabel}: ${fmt(p.x)}; ${ylabel}: ${fmt(p.y)}`); }
    svgNode(svg,'text',{x:(left+right)/2,y:334,'text-anchor':'middle',fill:'#233e52','font-size':13},xlabel);
    svgNode(svg,'text',{transform:`translate(17 ${(top+bottom)/2}) rotate(-90)`,'text-anchor':'middle',fill:'#233e52','font-size':13},ylabel);
  }
  function quantile(values,q) { const sorted=values.slice().sort((a,b)=>a-b),pos=(sorted.length-1)*q,lo=Math.floor(pos),t=pos-lo; return (1-t)*sorted[lo]+t*sorted[Math.ceil(pos)]; }
  function renderQQ(id,descriptionId,residuals,df) {
    const q=M.qq(residuals),points=q.map(p=>({x:p.theoretical,y:p.residual,label:`Row ${p.rowIndex+1}; normal quantile ${fmt(p.theoretical)}; residual ${fmt(p.residual)}`}));
    const q1=quantile(residuals,.25),q3=quantile(residuals,.75),slope=(q3-q1)/1.3489795003921634,intercept=(q1+q3)/2;
    const xs=extent(points.map(p=>p.x));
    plot(id,{points,lines:[{points:xs.map(x=>({x,y:intercept+slope*x})),color:'#b16612'}],xlabel:'Theoretical normal quantile',ylabel:'Ordered residual'});
    $(descriptionId).textContent=`${residuals.length} ordered fitted residuals, from ${fmt(Math.min(...residuals))} to ${fmt(Math.max(...residuals))}. The gold reference line passes through the first and third quartiles. Look for systematic bends or unusual tails, not perfect alignment.${df<=0?' No residual degrees of freedom: this plot cannot meaningfully assess the error distribution.':''}`;
  }
  function tornadoValues() {
    const f=state.fit,base=M.predict(f,state.references),rows=[];
    state.names.forEach((name,j)=>{
      const values=state.X.map(r=>r[j]),low=Math.min(...values),high=Math.max(...values),mid=low/2+high/2;
      const prediction=x=>{ const row=state.references.slice(); row[j]=x; return M.predict(f,row); };
      const pl=prediction(low),ph=prediction(high),pm=prediction(mid); if(![pl,ph,pm].every(Number.isFinite)) { rows.push({name,low,high,pl,ph,min:null,max:null,turn:null,width:null,base});return; } let min=Math.min(pl,ph),max=Math.max(pl,ph),turn=null;
      // In the supported basis each original predictor enters at most quadratically.
      const a=pl/2+ph/2-pm,b=ph/2-pl/2;
      if(a!==0 && high>low) { const t=-b/(2*a); if(Number.isFinite(t)&&t>-1&&t<1) { turn=mid+t*(high/2-low/2); const value=prediction(turn); if(Number.isFinite(value)){min=Math.min(min,value); max=Math.max(max,value);} } }
      rows.push({name,low,high,pl,ph,min,max,turn,width:max-min,base});
    });
    return rows.sort((a,b)=>b.width-a.width);
  }
  function drawTornado(rows) {
    const svg=$('wbTornado');svg.replaceChildren();
    const base=M.predict(state.fit,state.references),range=extent([base,...rows.flatMap(r=>[r.min,r.max])]),left=170,right=617,top=22,bottom=285,scale=Math.max(Math.abs(range[0]),Math.abs(range[1]))||1,x=v=>left+(v/scale-range[0]/scale)/(range[1]/scale-range[0]/scale)*(right-left);
    for(let i=0;i<=4;i++) { const v=(1-i/4)*range[0]+i/4*range[1]; svgNode(svg,'line',{x1:x(v),x2:x(v),y1:top,y2:bottom,stroke:'#dfe6e8'}); svgNode(svg,'text',{x:x(v),y:307,'text-anchor':'middle','font-size':12,fill:'#43556a'},fmt(v,2)); }
    const height=(bottom-top)/Math.max(rows.length,1);
    rows.forEach((r,i)=>{ const y=top+height*i+height*.18; svgNode(svg,'text',{x:left-10,y:y+height*.35,'text-anchor':'end','font-size':12,fill:'#233e52'},r.name.length>22?r.name.slice(0,20)+'…':r.name); const rect=svgNode(svg,'rect',{x:x(r.min),y,width:Math.max(1,x(r.max)-x(r.min)),height:height*.6,fill:'#277b88',rx:3}); svgNode(rect,'title',{},`${r.name}: predicted y ${fmt(r.min)} to ${fmt(r.max)} across observed input ${fmt(r.low)} to ${fmt(r.high)}`); });
    svgNode(svg,'line',{x1:x(base),x2:x(base),y1:top,y2:bottom,stroke:'#a45213','stroke-width':2,'stroke-dasharray':'5 4'});
    svgNode(svg,'text',{x:(left+right)/2,y:332,'text-anchor':'middle','font-size':13,fill:'#233e52'},'Predicted response (dashed line = reference)');
  }
  function renderPredictions() {
    const f=state.fit;if(!f?.ok) return;
    const j=Number($('wbPlotX').value)||0,values=state.X.map(r=>r[j]),low=Math.min(...values),high=Math.max(...values),base=M.predict(f,state.references);
    const outside=state.names.filter((_,i)=>state.references[i]<Math.min(...state.X.map(r=>r[i])) || state.references[i]>Math.max(...state.X.map(r=>r[i])));
    const referenceNotice=state.referenceWarning?`${state.referenceWarning} Last valid settings: ${state.names.map((name,i)=>`${name} = ${fmt(state.references[i])}`).join('; ')}. `:'';
    $('wbPrediction').textContent=`${referenceNotice}At ${state.referenceWarning?'those':'the reference'} settings, predicted ${state.data.headers[state.response]} = ${fmt(base)}.${outside.length?` Extrapolation warning: ${outside.join(', ')} is outside the observed range.`:''}`;
    if(!Number.isFinite(base)) { $('wbPrediction').textContent=referenceNotice+'This model cannot produce a finite prediction at these settings. Use smaller reference values.';$('wbSlice').replaceChildren();$('wbTornado').replaceChildren();$('wbTornadoTable').replaceChildren();$('wbSliceText').textContent='No model slice is shown for unsupported prediction settings.';$('wbTornadoText').textContent='No tornado is shown for unsupported prediction settings.';return; }
    const curve=Array.from({length:101},(_,i)=>{ const x=(1-i/100)*low+i/100*high,row=state.references.slice(); row[j]=x; return {x,y:M.predict(f,row)}; });
    const points=state.X.map((row,i)=>({x:row[j],y:state.y[i],label:`Source row ${state.rowIds[i]}: ${state.names[j]} ${fmt(row[j])}; observed y ${fmt(state.y[i])}`}));
    const lines=[{points:curve,color:'#b16612',width:3}];
    const overlay=state.names.length===1&&$('wbOverlay').checked,slope=Number($('wbOverlaySlope').value),intercept=Number($('wbOverlayIntercept').value);
    $('wbOverlay').disabled=state.names.length!==1;
    const validOverlay=$('wbOverlaySlope').value.trim() && $('wbOverlayIntercept').value.trim() && Number.isFinite(slope)&&Number.isFinite(intercept)&&Number.isFinite(slope*low+intercept)&&Number.isFinite(slope*high+intercept);
    if(overlay && validOverlay) lines.push({points:[{x:low,y:slope*low+intercept},{x:high,y:slope*high+intercept}],color:'#8e438f',dash:true});
    $('wbOverlayNote').textContent=state.names.length!==1?'Select exactly one candidate predictor to compare an external simple-regression line.':overlay&&!validOverlay?'Enter a valid slope and intercept whose predictions are finite. No comparison line is currently shown.':overlay?`Purple dashed comparison: y = ${fmt(intercept)} + ${fmt(slope)}x. It does not change the fitted model or inference.`:'The gold line is the fitted model; an enabled comparison appears purple and dashed.';
    plot('wbSlice',{points,lines,xlabel:state.names[j],ylabel:state.data.headers[state.response]});
    $('wbSliceText').textContent=`Gold: fitted ${state.names.length>1?'conditional model slice':'model'}. Blue: ${f.n} observations. ${state.names[j]} ranges from ${fmt(low)} to ${fmt(high)}.${state.names.length>1?' Other predictors stay at the reference settings above.':''}`;
    const tornado=tornadoValues();
    if(tornado.every(r=>Number.isFinite(r.width))) { drawTornado(tornado);$('wbTornadoText').textContent=tornado.map(r=>`${r.name}: prediction span ${fmt(r.width)}`).join('; ')+'. Larger spans mean greater sensitivity over these particular observed ranges, not smaller p-values.'; }
    else { $('wbTornado').replaceChildren();$('wbTornadoText').textContent='Some sensitivity predictions exceed the supported numeric range. Use less extreme reference settings. No tornado bars are shown.'; }
    table('wbTornadoTable',['Predictor','Input low','Input high','Predicted min','Predicted max','Span','Interior turn'],tornado.map(r=>[r.name,fmt(r.low),fmt(r.high),fmt(r.min),fmt(r.max),fmt(r.width),fmt(r.turn)]));
  }
  function renderDiagnostics() {
    const f=state.fit,range=extent([...state.y,...f.predictions]);
    plot('wbFitted',{points:f.predictions.map((x,i)=>({x,y:state.y[i],label:`Source row ${state.rowIds[i]}: fitted ${fmt(x)}; observed ${fmt(state.y[i])}`})),lines:[{points:range.map(x=>({x,y:x})),color:'#b16612'}],xlabel:'Fitted response',ylabel:'Observed response',xrange:range,yrange:range});
    $('wbFittedText').textContent=`${f.n} observations. The gold identity line marks an exact prediction. R² = ${fmt(f.r2)}; residual standard error = ${fmt(f.residualSE)}.`;
    const fx=extent(f.predictions),res=f.residuals;
    plot('wbResidual',{points:f.predictions.map((x,i)=>({x,y:res[i],label:`Source row ${state.rowIds[i]}: fitted ${fmt(x)}; residual ${fmt(res[i])}`})),lines:[{points:fx.map(x=>({x,y:0})),color:'#b16612'}],xlabel:'Fitted response',ylabel:'Residual (observed − fitted)'});
    $('wbResidualText').textContent=`Residuals range from ${fmt(Math.min(...res))} to ${fmt(Math.max(...res))}. Look for curves and changing spread. A high R² alone does not establish a suitable model.`;
    renderQQ('wbQQ','wbQQText',res,f.dfError);
    plot('wbOrder',{points:res.map((y,i)=>({x:i+1,y,label:`Analysis row ${i+1}, source row ${state.rowIds[i]}: residual ${fmt(y)}`})),lines:[{points:[{x:1,y:0},{x:f.n,y:0}],color:'#b16612'}],xlabel:'Analysis row order',ylabel:'Residual'});
    table('wbObservations',['Source row','Observed','Fitted','Residual','Leverage'],state.y.slice(0,200).map((v,i)=>[String(state.rowIds[i]),fmt(v),fmt(f.predictions[i]),fmt(res[i]),fmt(f.leverage[i]) ]));
    if(f.n>200) $('wbObservations').append(el('caption','First 200 observations shown. All rows are used in the model.'));
  }
  function suggest() {
    const entry=Number($('wbEntry').value),removal=Number($('wbRemoval').value);
    if(!Number.isFinite(entry)||!Number.isFinite(removal)||entry<.001||removal>.5||removal<entry) { $('wbSuggestion').textContent='Use thresholds from 0.001 through 0.5, with entry no larger than removal.'; return; }
    const removable=state.included.map((term,i)=>({term,p:state.fit.coefficients[i+1].p})).filter(r=>Number.isFinite(r.p)&&!state.included.some(t=>t.length>r.term.length&&contains(t,r.term))).sort((a,b)=>b.p-a.p);
    const addition=state.candidateResults.filter(r=>r.fit.ok&&Number.isFinite(r.p)).sort((a,b)=>a.p-b.p)[0];
    if(removable[0]?.p>removal) $('wbSuggestion').textContent=`Consider removing ${termLabel(removable[0].term)} (p = ${pformat(removable[0].p)}, above ${pformat(removal)}). Compare the refitted model and diagnostics before deciding.`;
    else if(addition && addition.p<entry) $('wbSuggestion').textContent=`Consider adding ${addition.added.map(t=>termLabel(t)).join(', ')} (${addition.added.length>1?'joint ':''}p = ${pformat(addition.p)}, below ${pformat(entry)}). The Add button makes this change; this suggestion does not change the model.`;
    else $('wbSuggestion').textContent='No eligible change meets these thresholds. That does not prove this is the best model. Check the research question, residual patterns, collinearity, and performance on new data.';
  }
  function updateSimple(points) {
    if(points.length<2) { table('simpleCoefficients',['Term','Estimate','SE','t','p','95% CI','VIF'],[]); $('simpleQQ').replaceChildren(); $('simpleQQText').textContent='Add points with different x-values to fit a model.'; return; }
    const fit=M.fit(points.map(p=>[p.x]),points.map(p=>p.y),[[0]],{center:false});
    if(!fit.ok) { $('simpleQQText').textContent=fit.error; $('simpleQQ').replaceChildren(); table('simpleCoefficients',['Term','Estimate','SE','t','p','95% CI','VIF'],[]); return; }
    table('simpleCoefficients',['Term','Estimate','SE','t','p','95% CI','VIF'],coefficientRows(fit,['Intercept','x']));
    renderQQ('simpleQQ','simpleQQText',fit.residuals,fit.dfError);
    // Replace the legacy hand-line table with the same fitted-model engine used by the builder.
    const rows=[['Regression',fmt(fit.ssr),String(fit.dfRegression),fmt(fit.dfRegression?fit.ssr/fit.dfRegression:null),fmt(fit.f),pformat(fit.p)],['Error',fmt(fit.sse),String(fit.dfError),fmt(fit.mse),'—','—'],['Total',fmt(fit.sst),String(fit.dfTotal),'—','—','—']];
    $('anovaTableBody').replaceChildren(...rows.map(cells=>{const tr=el('tr');cells.forEach(c=>tr.append(el('td',c)));return tr;}));
    $('anovaNote').textContent=`Least-squares ANOVA; independent of the comparison line. ${(fit.warnings||[]).join(' ')}`;
  }
  $('wbLoadExample').addEventListener('click',()=>{fileSequence++;loadData(D.example($('wbExample').value));});
  $('wbResponse').addEventListener('change',()=>{makePredictorOptions();markVariablesPending();});
  $('wbApplyVariables').addEventListener('click',applyVariables);
  $('wbStartEmpty').addEventListener('click',()=>changeModel([],'Started forward selection: intercept only.'));
  $('wbStartFull').addEventListener('click',()=>changeModel(state.candidates,'Started backward selection: all candidate terms.'));
  $('wbRebuildTerms').addEventListener('click',()=>{
    try { const candidates=generateCandidates(),allowed=new Set(candidates.map(key)),included=state.included.filter(t=>allowed.has(key(t))); const old=state.candidates; state.candidates=candidates; if(!changeModel(included,'Updated candidate term families.'))state.candidates=old; }
    catch(err){ status(err.message,true); }
  });
  $('wbUndo').addEventListener('click',()=>{ if(state.history.length<2)return;state.history.pop();const previous=state.history.at(-1);state.included=previous.included.map(t=>t.slice());state.candidates=previous.candidates.map(t=>t.slice());state.fit=previous.fit;['wbSquares','wbPairs','wbTriples'].forEach((id,i)=>$(id).checked=previous.flags[i]);state.revision++;renderModel(`Undid the last model change. ${previous.message}`); });
  $('wbSuggest').addEventListener('click',suggest);
  ['wbEntry','wbRemoval'].forEach(id=>$(id).addEventListener('input',()=>{$('wbSuggestion').textContent='Thresholds changed. Select “Suggest a next step” to evaluate the current choices.';}));
  $('wbPlotX').addEventListener('change',renderPredictions);
  ['wbOverlaySlope','wbOverlayIntercept'].forEach(id=>$(id).addEventListener('input',renderPredictions));
  $('wbOverlay').addEventListener('change',renderPredictions);
  function importText(text,description) {
    try { const data=D.parse(text); loadData(data,description); $('wbImportStatus').textContent=`Loaded ${data.rows.length} rows and ${data.headers.length} columns. ${data.missing} empty cells; ${data.nonnumeric} non-numeric cells. Select the intended numeric variables and review excluded rows.`; }
    catch(err) { $('wbImportStatus').textContent=`Import not applied: ${err.message} Previous data are unchanged.`; }
  }
  $('wbImport').addEventListener('click',()=>{fileSequence++;importText($('wbPaste').value,'Pasted dataset. No data were uploaded or saved.');});
  let fileSequence=0;
  $('wbFile').addEventListener('change',async event=>{
    const file=event.target.files[0],sequence=++fileSequence;if(!file)return;
    if(file.size>3_000_000){$('wbImportStatus').textContent='File is too large. Use a CSV smaller than 3 MB.';return;}
    try { const text=await file.text();if(sequence===fileSequence)importText(text,`Local file: ${file.name}. No data were uploaded or saved.`); }
    catch(err){$('wbImportStatus').textContent='Could not read that file. Try pasting the table instead.';}
    finally{event.target.value='';}
  });
  $('wbDownload').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([D.csv(state.data)],{type:'text/csv;charset=utf-8'})),a=el('a',null,{href:url,download:'regression-data.csv'});document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  function mode(builder) { $('modelStudio').hidden=!builder;$('studio').hidden=builder;$('builderMode').setAttribute('aria-pressed',String(builder));$('playgroundMode').setAttribute('aria-pressed',String(!builder));document.querySelector('.skip-link').href=builder?'#modelStudio':'#studio'; }
  $('builderMode').addEventListener('click',()=>mode(true));$('playgroundMode').addEventListener('click',()=>mode(false));
  window.RegressionWorkbench={updateSimple,getState:()=>({n:state.fit?.n,included:state.included.map(key),candidates:state.candidates.map(key),fit:state.fit,names:state.names.slice(),history:state.history.map(h=>h.message),revision:state.revision,tornado:state.fit?.ok?tornadoValues():[]})};
  loadData(D.example('sales'));mode(true);
})();
