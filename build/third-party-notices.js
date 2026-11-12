'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const pending=new Set(['lazy-val@1.0.5']);
function safe(root,relative){
 if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||relative.startsWith('/')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe notice input path');
 let p=root;for(const part of relative.split('/')){p=path.join(p,part);if(fs.existsSync(p)&&fs.lstatSync(p).isSymbolicLink())throw Error('Notice input/output must not be a link');}return p;
}
function read(root,relative){const p=safe(root,relative),s=fs.lstatSync(p);if(!s.isFile()||s.size>2*1024*1024)throw Error('Invalid notice file');return fs.readFileSync(p,'utf8');}
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function supplement(root,entry,p,location){
 if(entry.license!==p.license||typeof entry.reviewRequired!=='boolean'||!entry.inputHashes||typeof entry.inputHashes!=='object'||Array.isArray(entry.inputHashes)||!entry.inputHashes['package.json']||Object.keys(entry.inputHashes).length<2||!Array.isArray(entry.notices)||!entry.notices.length||entry.notices.length>8)throw Error('Invalid license supplement');
 for(const [file,expected]of Object.entries(entry.inputHashes))if(!/^[a-f0-9]{64}$/.test(expected)||hash(read(root,location+'/'+file))!==expected)throw Error('License supplement input changed; review required');
 const notices=entry.notices.map(n=>{if(!/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(n.file)||!/^[a-f0-9]{64}$/.test(n.sha256)||typeof n.kind!=='string')throw Error('Invalid license supplement file');const name='build/license-supplements/'+n.file,text=read(root,name);if(hash(text)!==n.sha256)throw Error('License supplement text changed; review required');return{name,text,kind:n.kind};});
 return{notices,reviewRequired:entry.reviewRequired,additionalLicenses:entry.additionalLicenses||[],provenance:entry.provenance||[]};
}
function collect(root){
 root=path.resolve(root);const lock=JSON.parse(read(root,'package-lock.json'));if(!lock.packages||typeof lock.packages!=='object')throw Error('Missing lockfile package inventory');
 const manifestPath='build/license-supplements/manifest.json';
 const supplements=fs.existsSync(safe(root,manifestPath))?JSON.parse(read(root,manifestPath)):{schema:1,packages:{}};
 if(supplements.schema!==1||!supplements.packages||typeof supplements.packages!=='object'||Array.isArray(supplements.packages))throw Error('Invalid license supplement inventory');
 const items=[],parts=['Femboy Launcher — third-party notices','Generated from the installed packages matching package-lock.json. Upstream licenses remain unchanged.','A pending review is explicitly identified below; this file is not a legal clearance.'];
 for(const [location,entry] of Object.entries(lock.packages).sort(([a],[b])=>a.localeCompare(b,'en'))){
  if(!location||entry.dev)continue;if(!location.startsWith('node_modules/'))throw Error('Unexpected production package path');
  const p=JSON.parse(read(root,location+'/package.json'));if(p.version!==entry.version||typeof p.name!=='string'||typeof p.license!=='string'||!p.license.trim())throw Error('Production package version/license does not match the inventory');
  const dir=safe(root,location),files=fs.readdirSync(dir).filter(n=>/^(?:licen[sc]e|copying|copyright|notice)(?:[.-]|$)/i.test(n)&&fs.lstatSync(path.join(dir,n)).isFile());
  const notices=[];for(const name of files)notices.push({name,text:read(root,location+'/'+name)});
  if(!notices.length&&p.name==='assert-plus'&&p.version==='1.0.0'){
   const text=read(root,location+'/README.md'),section=text.match(/^## License\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1];
   if(!section||!section.includes('Permission is hereby granted')||!section.includes('Mark Cavage'))throw Error('assert-plus notice could not be preserved');notices.push({name:'README.md#License',text:section.trim()});
  }
  let extra=null;
  if(!notices.length&&Object.hasOwn(supplements.packages,p.name+'@'+p.version)){extra=supplement(root,supplements.packages[p.name+'@'+p.version],p,location);notices.push(...extra.notices);}
  const reviewRequired=!notices.length||extra?.reviewRequired===true;if(reviewRequired&&!pending.has(p.name+'@'+p.version))throw Error('Production package has no distributable notice: '+p.name);
  const item={name:p.name,version:p.version,location,license:p.license,reviewRequired,notices:notices.map(n=>({source:n.name,sha256:hash(n.text),...(n.kind?{kind:n.kind}:{})})),...(extra?{additionalLicenses:extra.additionalLicenses,provenance:extra.provenance}:{})};items.push(item);
  parts.push('\n'+'='.repeat(72),p.name+' '+p.version,'Declared license: '+p.license);
  if(reviewRequired)parts.push('REVIEW REQUIRED: the installed package declares this license but does not include a full upstream copyright notice. Any canonical reference below is not presented as a recovered upstream file.');
  for(const n of notices)parts.push('Source: '+n.name,n.text);
 }
 if(!items.length)throw Error('Empty production notice inventory');
 return {text:parts.join('\n')+'\n',inventory:{schema:1,complete:items.every(x=>!x.reviewRequired),packages:items}};
}
function generate(root){const result=collect(root);const folder=safe(root,'build/generated-notices');fs.mkdirSync(folder,{recursive:true});for(const [name,body] of [['THIRD_PARTY_NOTICES.txt',result.text],['NOTICE-INVENTORY.json',JSON.stringify(result.inventory,null,2)+'\n']]){const dest=safe(root,'build/generated-notices/'+name),temp=dest+'.tmp-'+crypto.randomBytes(6).toString('hex');try{fs.writeFileSync(temp,body,{flag:'wx'});fs.renameSync(temp,dest);}finally{fs.rmSync(temp,{force:true});}}return result.inventory;}
async function beforePack(context){generate(context.packager.projectDir);}
module.exports=beforePack;module.exports.collect=collect;module.exports.generate=generate;
if(require.main===module){const inventory=generate(path.join(__dirname,'..'));console.log(JSON.stringify({packages:inventory.packages.length,complete:inventory.complete,pending:inventory.packages.filter(p=>p.reviewRequired).map(p=>p.name+'@'+p.version)}));}
