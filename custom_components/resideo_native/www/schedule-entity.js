/* Resideo Native: scoped editor links and reviewed mode-switch dialogs. */
export function scheduleEditorUrl(hass, entityId) {
  if (!/^(sensor|switch)\.[a-z0-9_]+$/.test(entityId || "")) return null;
  const attrs=hass?.states?.[entityId]?.attributes;
  if((attrs?.resideo_schedule_editor!==true && attrs?.resideo_schedule_mode!==true) || typeof attrs.editor_url!=="string")return null;
  try {
    const url=new URL(attrs.editor_url,globalThis.location?.origin || "http://localhost");
    if(url.origin!==(globalThis.location?.origin || "http://localhost") || url.pathname!=="/resideo-schedules" || !url.searchParams.get("config_entry"))return null;
    return url.pathname+url.search;
  } catch {return null;}
}
export function scheduleModeSwitchRequest(event) {
  if(event.defaultPrevented || event.type==="click" && event.button!==0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)return null;
  const path=event.composedPath?.() || [];
  const control=path.find(el=>["ha-switch","ha-entity-toggle"].includes(el?.localName));
  const generic=path.find(el=>el?.localName==="hui-generic-entity-row");
  if(!control || control.disabled || control.hasAttribute?.("disabled") || !generic)return null;
  const id=generic.config?.entity,hass=generic.hass,state=hass?.states?.[id];
  if(!id?.startsWith("switch.") || state?.attributes?.resideo_schedule_mode!==true || !["on","off"].includes(state.state))return null;
  const url=scheduleEditorUrl(hass,id);
  return url?{hass,url,mode:state.state==="on"?"Timed":"Geofence",control,checked:state.state==="on"}:null;
}
let activeDialog=null;
export async function openScheduleModeDialog(hass, url, mode) {
  if(activeDialog?.open)return;
  const parsed=new URL(url,location.origin), entity=parsed.searchParams.get("entity"), entry=parsed.searchParams.get("config_entry");
  if(!entity || !entry || !["Timed","Geofence"].includes(mode))return;
  const dialog=document.createElement("dialog");activeDialog=dialog;
  const surface=hass.themes?.darkMode?"#1c1c1c":"#fff";
  Object.assign(dialog.style,{position:"fixed",inset:"0",margin:"auto",padding:"20px",border:"1px solid var(--divider-color,#ddd)",borderRadius:"20px",width:"min(1180px,calc(100vw - 28px))",maxWidth:"calc(100vw - 28px)",maxHeight:"calc(100dvh - 28px)",boxSizing:"border-box",overflow:"auto",background:surface,color:"var(--primary-text-color,#20232b)"});
  dialog.style.setProperty("--card-background-color",surface);
  dialog.style.setProperty("--primary-text-color",hass.themes?.darkMode?"#e1e1e1":"#20232b");
  dialog.style.setProperty("--secondary-text-color",hass.themes?.darkMode?"#b0b0b0":"#69717f");
  dialog.style.setProperty("--secondary-background-color",hass.themes?.darkMode?"#303030":"#f3f5f8");
  const style=document.createElement("style");style.textContent="dialog.resideo-mode-popup::backdrop{background:rgba(0,0,0,.5)}";
  dialog.className="resideo-mode-popup";dialog.setAttribute("aria-label",mode==="Geofence"?"Geofencing setup":"Timed schedule setup");
  const header=document.createElement("div");Object.assign(header.style,{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"16px",marginBottom:"16px"});
  const title=document.createElement("h2");title.textContent=mode==="Geofence"?"Geofencing setup":"Timed schedule setup";Object.assign(title.style,{font:"600 22px system-ui",margin:"0"});
  const cancel=document.createElement("button");cancel.textContent="Cancel";Object.assign(cancel.style,{font:"inherit",padding:"9px 16px",borderRadius:"10px",border:"1px solid #ccc",background:surface,color:"inherit",cursor:"pointer"});
  const caption=document.createElement("p");caption.textContent=(hass.states?.[entity]?.attributes?.friendly_name || entity)+" · Editor 0.3.2";Object.assign(caption.style,{font:"13px system-ui",margin:"4px 0 0",color:"var(--secondary-text-color)"});
  const heading=document.createElement("div");heading.append(title,caption);
  header.append(heading,cancel);dialog.append(style,header);document.body.append(dialog);
  let editor;
  const close=()=>{if(editor && !editor.canClose)return;dialog.close();dialog.remove();if(activeDialog===dialog)activeDialog=null;};
  cancel.addEventListener("click",close);dialog.addEventListener("cancel",event=>{event.preventDefault();close();});dialog.showModal();
  try {
    const {PANEL_ELEMENT}=await import("./schedule-editor-0.3.2.js");
    if(!dialog.isConnected)return;
    editor=document.createElement(PANEL_ELEMENT);editor.setConfig({dialog:true,entity,config_entry:entry,mode});editor.hass=hass;
    editor.addEventListener("resideo-mode-saved",()=>{dialog.close();dialog.remove();activeDialog=null;});dialog.append(editor);
  } catch(error) {
    const message=document.createElement("p");message.textContent="Could not open schedule setup. Refresh Home Assistant after installing the complete integration folder. "+String(error.message || error);dialog.append(message);
  }
}
if(globalThis.window && globalThis.document) {
  for(const [key,type] of [["__resideoScheduleEntityHandler","hass-more-info"],["__resideoSchedulePressHandler","click"],["__resideoScheduleModeHandler","click"],["__resideoScheduleModeChangeHandler","change"]])if(window[key])window.removeEventListener(type,window[key],true);
  const moreInfo=event=>{
    if(!event.detail?.entityId || event.detail.view || event.detail.tab)return;
    const host=event.composedPath().find(el=>el?.hass) || document.querySelector("home-assistant"),hass=host?.hass,id=event.detail.entityId,url=scheduleEditorUrl(hass,id);
    if(!url)return;
    event.stopImmediatePropagation();
    if(hass.states[id].attributes.resideo_schedule_mode===true)void openScheduleModeDialog(hass,url,hass.states[id].state==="on"?"Timed":"Geofence");
    else window.location.assign(url);
  };
  const toggle=event=>{
    const request=scheduleModeSwitchRequest(event);if(!request)return;
    event.preventDefault();event.stopImmediatePropagation();request.control.checked=request.checked;void openScheduleModeDialog(request.hass,request.url,request.mode);
  };
  window.__resideoScheduleEntityHandler=moreInfo;window.__resideoScheduleModeHandler=toggle;window.__resideoScheduleModeChangeHandler=toggle;
  window.addEventListener("hass-more-info",moreInfo,true);window.addEventListener("click",toggle,true);window.addEventListener("change",toggle,true);
}
