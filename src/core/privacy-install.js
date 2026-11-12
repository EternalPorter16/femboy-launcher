'use strict';
const fs=require('fs');
const keys=['backgroundUpdateChecks','discordRpc','modUpdatesCheck','readinessCheck'];
function apply(file,store){
 let record;try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>4096)return 'invalid';record=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){return e.code==='ENOENT'?'absent':'invalid';}
 if(record?.schema!==1||typeof record.id!=='string'||!/^\d{1,12}-\d{1,12}$/.test(record.id)||!record.settings||Object.keys(record.settings).length!==keys.length||keys.some(k=>typeof record.settings[k]!=='boolean'))return 'invalid';
 const data=store.get();if(data.privacyInstallApplied===record.id)return 'already-applied';
 // Save the user's installer choices before any background service is started.
 data.settings={...data.settings,...record.settings};data.privacyInstallApplied=record.id;store.save();return 'applied';
}
module.exports={apply,keys};
