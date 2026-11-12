const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {collect}=require('../build/third-party-notices');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(t,name='example',version='1.0.0',reviewRequired=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fl-license-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 function write(p,s){fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),s);}
 const pkg=JSON.stringify({name,version,license:'MIT'}),code='module.exports=1;',notice='Preserved attribution and permission notice\n';
 write('package-lock.json',JSON.stringify({packages:{'node_modules/example':{version}}}));write('node_modules/example/package.json',pkg);write('node_modules/example/index.js',code);write('build/license-supplements/notice.txt',notice);
 const manifest={schema:1,packages:{[name+'@'+version]:{license:'MIT',reviewRequired,inputHashes:{'package.json':hash(pkg),'index.js':hash(code)},notices:[{file:'notice.txt',sha256:hash(notice),kind:'upstream-license'}],additionalLicenses:['Unicode-3.0'],provenance:[{url:'https://example.org/source'}]}}};
 const save=()=>write('build/license-supplements/manifest.json',JSON.stringify(manifest));save();return{root,write,manifest,save};
}
test('pinned supplements preserve text and provenance in the generated inventory',t=>{const f=fixture(t),r=collect(f.root);assert.equal(r.inventory.complete,true);assert.ok(r.text.includes('Preserved attribution and permission notice'));assert.equal(r.inventory.packages[0].notices[0].kind,'upstream-license');assert.deepEqual(r.inventory.packages[0].additionalLicenses,['Unicode-3.0']);assert.equal(r.inventory.packages[0].provenance[0].url,'https://example.org/source');});
test('changed dependency source requires a new notice review',t=>{const f=fixture(t);f.write('node_modules/example/index.js','module.exports=2;');assert.throws(()=>collect(f.root),/input changed/);});
test('changed preserved notice cannot silently enter a package',t=>{const f=fixture(t);f.write('build/license-supplements/notice.txt','Replacement notice');assert.throws(()=>collect(f.root),/text changed/);});
test('a dependency upgrade cannot inherit the old supplemental notice',t=>{const f=fixture(t);f.write('package-lock.json',JSON.stringify({packages:{'node_modules/example':{version:'2.0.0'}}}));f.write('node_modules/example/package.json',JSON.stringify({name:'example',version:'2.0.0',license:'MIT'}));assert.throws(()=>collect(f.root),/no distributable notice/);});
test('supplemental notice traversal and malformed inventories are rejected',t=>{const f=fixture(t);f.manifest.packages['example@1.0.0'].notices[0].file='../notice.txt';f.save();assert.throws(()=>collect(f.root),/Invalid license supplement file/);f.manifest.packages=[];f.save();assert.throws(()=>collect(f.root),/Invalid license supplement inventory/);});
test('canonical reference for lazy-val keeps upstream copyright review open',t=>{const f=fixture(t,'lazy-val','1.0.5',true),r=collect(f.root);assert.equal(r.inventory.complete,false);assert.equal(r.inventory.packages[0].reviewRequired,true);assert.ok(r.text.includes('not presented as a recovered upstream file'));});
// Тексты в build/license-supplements сверяются по SHA-256 побайтно: в любой копии репозитория они должны выйти из git с LF,
// даже при core.autocrlf=true (обычная настройка Windows и раннеров GitHub). Правило — в .gitattributes
test('license supplements are checked out with LF under any core.autocrlf',()=>{
 const root=path.join(__dirname,'..'),dir=path.join(root,'build','license-supplements'),{execFileSync}=require('node:child_process');
 const files=fs.readdirSync(dir).map(n=>'build/license-supplements/'+n);
 assert.ok(files.length>=5);
 const out=execFileSync('git',['check-attr','eol','--',...files],{cwd:root,encoding:'utf8',windowsHide:true});
 for(const f of files)assert.match(out,new RegExp(f.replace(/[.]/g,'\.')+': eol: lf'),f);
 for(const f of files)assert.ok(!fs.readFileSync(path.join(root,f)).includes(13),f+' contains CR');
});
