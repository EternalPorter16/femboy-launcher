'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function verify(context){
 const root=context.packager.projectDir,out=context.appOutDir;
 if(context.electronPlatformName!=='win32')throw Error('Packaged notice verification currently supports Windows only');
 for(const [from,to] of [['build/privacy-notice-en.txt','resources/licenses/PRIVACY-NOTICE-EN.txt'],['build/privacy-notice.txt','resources/licenses/PRIVACY-NOTICE.txt'],['LICENSE','resources/licenses/Femboy-Launcher-GPL-3.0.txt'],['src/renderer/fonts/LICENSE-fonts.txt','resources/licenses/FONT-LICENSES.txt'],['build/generated-notices/THIRD_PARTY_NOTICES.txt','resources/licenses/THIRD_PARTY_NOTICES.txt'],['build/generated-notices/NOTICE-INVENTORY.json','resources/licenses/NOTICE-INVENTORY.json'],['node_modules/electron/dist/LICENSE','LICENSE.electron.txt'],['node_modules/electron/dist/LICENSES.chromium.html','LICENSES.chromium.html']]){
  if(hash(fs.readFileSync(path.join(root,from)))!==hash(fs.readFileSync(path.join(out,to))))throw Error('Required distribution notice was changed or omitted');
 }
 const inventory=JSON.parse(fs.readFileSync(path.join(out,'resources/licenses/NOTICE-INVENTORY.json'),'utf8'));
 if(inventory.schema!==1||!Array.isArray(inventory.packages)||!inventory.packages.length)throw Error('Invalid packaged notice inventory');
 const asar=require('@electron/asar'),archive=path.join(out,'resources/app.asar');
 const packages=asar.listPackage(archive).map(p=>p.replaceAll('\\','/').replace(/^\//,'')).filter(p=>/^node_modules\/(?:@[^/]+\/)?[^/]+\/(?:node_modules\/(?:@[^/]+\/)?[^/]+\/)*package[.]json$/.test(p));
 if(!packages.length)throw Error('No packaged dependencies found for notice verification');
 for(const file of packages){const p=JSON.parse(asar.extractFile(archive,file.replaceAll('/',path.sep)));if(!inventory.packages.some(i=>i.name===p.name&&i.version===p.version&&i.license===p.license))throw Error('Packaged dependency is absent from notice inventory');}
 return {packages:packages.length,inventoryPackages:inventory.packages.length,complete:inventory.complete};
}
module.exports=verify;
