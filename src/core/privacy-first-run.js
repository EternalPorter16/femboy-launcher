'use strict';
const fs=require('node:fs'),path=require('node:path');
const {keys}=require('./privacy-install');
function hasProfile(file){const r=require('./fsx').readJson(file);return !!(r.ok&&r.data&&typeof r.data==='object'&&!Array.isArray(r.data)&&r.data.settings&&typeof r.data.settings==='object'&&!Array.isArray(r.data.settings));}
function validSettings(value){return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>typeof value[k]==='boolean');}
function saveChoice(store,settings,lang){
 if(!validSettings(settings)||!['ru','en'].includes(lang))throw Error('Invalid privacy choice');
 const data=store.get(),previous=data.settings,marker=data.privacyFirstRun;
 data.settings={...previous,...settings,lang};data.privacyFirstRun=1;
 try{store.save();}catch(e){data.settings=previous;if(marker===undefined)delete data.privacyFirstRun;else data.privacyFirstRun=marker;throw e;}
}
function notice(file){const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024)throw Error('Privacy notice unavailable');const b=fs.readFileSync(file),text=b[0]===255&&b[1]===254?b.subarray(2).toString('utf16le'):b.toString('utf8');if(text.trim().length<200)throw Error('Privacy notice unavailable');return text;}
async function show({BrowserWindow,ipcMain,store,policyFiles,lang='ru',rendererDir=path.join(__dirname,'../renderer')}){
 const policies={ru:notice(policyFiles.ru),en:notice(policyFiles.en)};
 const window=new BrowserWindow({width:820,height:760,minWidth:620,minHeight:620,title:lang==='en'?'Privacy and network features':'Приватность и сетевые функции',autoHideMenuBar:true,webPreferences:{preload:path.join(rendererDir,'privacy-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
 let settled=false;const channels=['privacy-first:read','privacy-first:choose','privacy-first:cancel'];
 const authorized=e=>{if(window.isDestroyed()||e.sender!==window.webContents)throw Error('Privacy window only');};
 return new Promise((resolve,reject)=>{
  const cleanup=()=>channels.forEach(n=>ipcMain.removeHandler(n));
  ipcMain.handle(channels[0],e=>{authorized(e);return{policies,lang};});
  ipcMain.handle(channels[1],(e,payload)=>{authorized(e);if(settled)return{ok:false};try{saveChoice(store,payload?.settings,payload?.lang);settled=true;cleanup();resolve({accepted:true,close:()=>{if(!window.isDestroyed())window.close();}});return{ok:true};}catch{return{ok:false};}});
  ipcMain.handle(channels[2],e=>{authorized(e);window.close();return true;});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',e=>e.preventDefault());
  window.on('closed',()=>{cleanup();if(!settled){settled=true;resolve({accepted:false});}});
  window.loadFile(path.join(rendererDir,'privacy.html')).catch(e=>{if(!settled){settled=true;cleanup();window.destroy();reject(e);}});
 });
}
module.exports={show,saveChoice,validSettings,hasProfile};
