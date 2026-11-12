const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('privacyChoice',Object.freeze({read:()=>ipcRenderer.invoke('privacy-first:read'),choose:payload=>ipcRenderer.invoke('privacy-first:choose',payload),cancel:()=>ipcRenderer.invoke('privacy-first:cancel')}));
