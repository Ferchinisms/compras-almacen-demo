
/* Lector PDF v2.6 - Compras y Almacén */
(function(){
const pdfURL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
async function ensurePDF(){
 if(window.pdfjsLib)return window.pdfjsLib;
 await new Promise((resolve,reject)=>{
  const s=document.createElement('script');
  s.src=pdfURL;s.onload=resolve;
  s.onerror=()=>reject(Error('No se pudo cargar PDF.js'));
  document.head.appendChild(s);
 });
 pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
 return pdfjsLib;
}
const num=s=>Number(String(s||'0').replace(/[$,\s]/g,''));
const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
function linesFromItems(items){
 const byY=[];
 for(const x of items){
  if(!x.str?.trim())continue;
  const y=x.transform?.[5]||0;
  let line=byY.find(a=>Math.abs(a.y-y)<2.5);
  if(!line){line={y,parts:[]};byY.push(line)}
  line.parts.push({x:x.transform?.[4]||0,t:clean(x.str)});
 }
 return byY.sort((a,b)=>b.y-a.y).map(a=>
  a.parts.sort((p,q)=>p.x-q.x).map(p=>p.t).join(' ').replace(/\s+/g,' ').trim()
 );
}
function parseROQUNET(lines){
 const rows=[];
 for(let i=0;i<lines.length;i++){
  const desc=lines[i].match(/(?:^|\s)Descripci[oó]n\s+(.+)/i);
  if(!desc)continue;
  const description=clean(desc[1]).replace(/\s+(?:IVA|Traslado).*$/i,'');
  let quantity=null,price=null;
  for(let j=i-1;j>=Math.max(0,i-5);j--){
   const m=lines[j].match(/\b43222817\b\s+(\d+(?:\.\d+)?)\s+H87\s+Pieza\s+([\d,.]+)\s+([\d,.]+)/i);
   if(m){quantity=num(m[1]);price=num(m[2]);break}
  }
  if(quantity!==null&&price!==null&&description){
   rows.push({descripcion:description,cantidad:quantity,precio:price,descuento:0,unidad:'Pieza'});
  }
 }
 return rows;
}
function parseGeneric(lines){
 const out=[];
 for(const l of lines){
  const m=l.match(/^\s*(\d+(?:\.\d+)?)\s+(?:(?:H87|PZA|Pieza|Unidad)\s+)?(.{5,}?)\s+\$?([\d,]+\.\d{2,6})\s+\$?([\d,]+\.\d{2,6})\s*$/i);
  if(m&&Math.abs(num(m[1])*num(m[3])-num(m[4]))<0.05){
   out.push({cantidad:num(m[1]),descripcion:clean(m[2]),precio:num(m[3]),descuento:0,unidad:'Pieza'});
  }
 }
 return out;
}
function findAmount(lines,label){
 for(const l of lines){
  const re=new RegExp('\\b'+label+'\\b[^\\d$]{0,35}\\$?\\s*([\\d,]+\\.\\d{2})','i');
  const m=l.match(re);
  if(m)return num(m[1]);
 }
 return null;
}
window.importPDFFile=async function(file){
 try{
  const lib=await ensurePDF();
  const pdf=await lib.getDocument({data:await file.arrayBuffer()}).promise;
  let lines=[];
  for(let i=1;i<=pdf.numPages;i++){
   const p=await pdf.getPage(i),c=await p.getTextContent();
   lines.push(...linesFromItems(c.items));
  }
  const full=lines.join('\n');
  const uuid=(full.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i)||[])[0]||'';
  const rfcs=[...full.matchAll(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/gi)].map(x=>x[0]);
  const date=(full.match(/20\d{2}-[01]\d-[0-3]\d/)||[])[0]||'';
  const subtotal=findAmount(lines,'Subtotal'),iva=findAmount(lines,'IVA'),total=findAmount(lines,'Total');
  let extracted=parseROQUNET(lines);
  if(!extracted.length)extracted=parseGeneric(lines);
  const known=db.proveedores.find(p=>rfcs.some(r=>(p.rfc||'').toUpperCase()===r.toUpperCase()));
  const draft={
   archivo:file.name,uuid,folio:uuid||file.name.replace(/\.pdf$/i,''),
   fecha:date,proveedor:known?.id||'',
   subtotal:subtotal??0,iva:iva??0,total:total??0,
   rows:extracted.map(r=>({
    id:id(),...r,
    producto:db.productos.find(p=>clean(p.nombre).toLowerCase()===clean(r.descripcion).toLowerCase())?.id||'',
    origen:'PDF',archivo:file.name,uuid,
    rfcEmisor:rfcs[0]||'',rfcReceptor:rfcs[1]||''
   }))
  };
  const box=document.querySelector('#invoiceDraft');
  if(!box)throw Error('Abre la pestaña Facturas.');
  const status=extracted.length?`Se detectaron ${extracted.length} partidas. Verifica cantidades y precios antes de guardar.`:'No se identificaron partidas automáticamente. No se guardó nada.';
  box.innerHTML=`<div class="panel"><h3>Revisión del PDF</h3>
  <p>${esc(status)}</p>
  <p><b>UUID:</b> ${esc(uuid||'No identificado')} · <b>Fecha:</b> ${esc(date||'No identificada')}</p>
  <label>Proveedor existente<select id="pProveedor"><option value="">Selecciona proveedor</option>${opt('proveedores')}</select></label>
  <label>Nombre del proveedor nuevo (opcional)<input id="pNuevo" placeholder="Si no existe en catálogo"></label>
  <label>RFC del proveedor nuevo (opcional)<input id="pRFC" value="${esc(rfcs[0]||'')}"></label>
  <label>Folio<input id="pFolio" value="${esc(draft.folio)}"></label>
  <label>Fecha<input id="pFecha" type="date" value="${esc(date)}"></label>
  <div class="scroll"><table><thead><tr><th>Descripción (editable)</th><th>Cantidad</th><th>Precio sin IVA</th><th>Producto existente</th></tr></thead>
  <tbody id="pRows">${draft.rows.map((r,i)=>`<tr>
  <td><input data-i="${i}" data-f="descripcion" value="${esc(r.descripcion)}"></td>
  <td><input data-i="${i}" data-f="cantidad" type="number" min="0.001" step="any" value="${r.cantidad}"></td>
  <td><input data-i="${i}" data-f="precio" type="number" min="0" step="any" value="${r.precio}"></td>
  <td><select data-i="${i}" data-f="producto"><option value="">Crear producto nuevo</option>${opt('productos')}</select></td>
  </tr>`).join('')}</tbody></table></div>
  <p>Subtotal PDF: ${money(draft.subtotal)} · IVA PDF: ${money(draft.iva)} · Total PDF: <b>${money(draft.total)}</b></p>
  <p id="pCheck"></p>
  <button type="button" id="pGuardar" ${!extracted.length?'disabled':''}>Guardar ${extracted.length} partidas</button>
  <button type="button" id="pCancelar" class="danger">Cancelar</button>
  <details><summary>Ver texto extraído para diagnóstico</summary>
  <textarea readonly style="min-height:180px">${esc(full.slice(0,30000))}</textarea></details></div>`;
  document.querySelector('#pProveedor').value=draft.proveedor;
  draft.rows.forEach((r,i)=>{
   document.querySelector(`select[data-i="${i}"][data-f="producto"]`).value=r.producto;
  });
  const readRows=()=>draft.rows.map((r,i)=>{
   const row={...r};
   document.querySelectorAll(`[data-i="${i}"]`).forEach(el=>{
    row[el.dataset.f]=el.type==='number'?Number(el.value):el.value;
   });
   return row;
  });
  const update=()=>{
   const sum=readRows().reduce((s,r)=>s+r.cantidad*r.precio,0);
   document.querySelector('#pCheck').textContent=`Suma de partidas: ${money(sum)}. Diferencia contra subtotal: ${money(sum-draft.subtotal)}.`;
  };
  box.querySelectorAll('[data-i]').forEach(el=>el.addEventListener('input',update));
  update();
  document.querySelector('#pCancelar').onclick=()=>box.innerHTML='';
  document.querySelector('#pGuardar').onclick=()=>{
   const rows=readRows(),sum=rows.reduce((s,r)=>s+r.cantidad*r.precio,0);
   if(!rows.length||rows.some(r=>!clean(r.descripcion)||!(r.cantidad>0)||!Number.isFinite(r.precio)||r.precio<0)){
    return alert('Revisa descripciones, cantidades y precios.');
   }
   if(draft.subtotal>0&&Math.abs(sum-draft.subtotal)>0.05&&!confirm(`La suma de partidas (${money(sum)}) no coincide con el subtotal (${money(draft.subtotal)}). ¿Guardar de todas formas?`))return;
   if(uuid&&db.facturas.some(x=>x.uuid?.toLowerCase()===uuid.toLowerCase())){
    return alert('Esta factura ya existe (UUID duplicado).');
   }
   let provider=db.proveedores.find(p=>p.id===document.querySelector('#pProveedor').value);
   const newName=clean(document.querySelector('#pNuevo').value);
   const newRFC=clean(document.querySelector('#pRFC').value).toUpperCase();
   if(!provider&&!newName)return alert('Selecciona un proveedor o escribe uno nuevo.');
   if(!provider){
    provider={id:id(),nombre:newName,rfc:newRFC,telefono:'',correo:'',registradoEn:nowStamp()};
   }
   const products=[];
   for(const r of rows){
    let prod=db.productos.find(p=>p.id===r.producto)||
     products.find(p=>p.nombre.toLowerCase()===clean(r.descripcion).toLowerCase())||
     db.productos.find(p=>p.nombre.toLowerCase()===clean(r.descripcion).toLowerCase());
    if(!prod){
     prod={id:id(),nombre:clean(r.descripcion),unidad:r.unidad||'Pieza',
      costo:r.precio,marca:'',modelo:'',especificaciones:'',datasheet:'',
      registradoEn:nowStamp()};
     products.push(prod);
    }
    r.producto=prod.id;
   }
   const folio=clean(document.querySelector('#pFolio').value);
   const fecha=document.querySelector('#pFecha').value;
   if(!db.proveedores.some(p=>p.id===provider.id))db.proveedores.push(provider);
   db.productos.push(...products);
   db.facturas.push(...rows.map(r=>({
    ...r,id:id(),proveedor:provider.id,folio,fecha,
    subtotal:draft.subtotal,iva:draft.iva,total:draft.total,
    registradoEn:nowStamp()
   })));
   save();
   alert(`Factura guardada: ${rows.length} partidas.`);
   show('Facturas');
  };
 }catch(e){
  alert('No se pudo leer el PDF: '+e.message);
  console.error(e);
 }
};
})();
