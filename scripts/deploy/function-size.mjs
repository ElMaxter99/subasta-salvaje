#!/usr/bin/env node
// Tamaño aproximado de cada función de Vercel (archivos que Next traza para cada ruta, sin comprimir).
// Uso: npm run build && npm run size:functions   — sirve para vigilar que no vuelva a crecer (ver docs/OPERACIONES.md).
import fs from 'node:fs'; import path from 'node:path';
const root='.next/server'; const out=[];
function walk(d){for(const n of fs.readdirSync(d)){const p=path.join(d,n);const s=fs.statSync(p);if(s.isDirectory())walk(p);else if(n.endsWith('.nft.json'))out.push(p);}}
walk(root);
const rows=[];const agg={};
for(const f of out){const j=JSON.parse(fs.readFileSync(f));let tot=0;const base=path.dirname(f);for(const rel of j.files){const p=path.resolve(base,rel);try{const st=fs.statSync(p);if(st.isFile()){tot+=st.size;const m=p.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);const k=m?m[1]:'(app)';agg[k]=(agg[k]||0)+st.size;}}catch{}}rows.push([f.replace(root+'/',''),tot]);}
rows.sort((a,b)=>b[1]-a[1]);
console.log('funciones con traza:',rows.length);
for(const r of rows.slice(0,6))console.log((r[1]/1e6).toFixed(1)+'MB',r[0]);
console.log('mediana', (rows[Math.floor(rows.length/2)][1]/1e6).toFixed(1)+'MB');
console.log('suma todas', (rows.reduce((a,r)=>a+r[1],0)/1e6).toFixed(0)+'MB');
