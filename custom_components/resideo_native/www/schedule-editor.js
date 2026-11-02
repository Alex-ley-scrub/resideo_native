/* Resideo Native 0.3.2. Local UI; all account access stays in HA. */
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const EDITOR_VERSION = "0.3.2";
export const PANEL_ELEMENT = `resideo-schedule-panel-${EDITOR_VERSION.replaceAll(".", "-")}`;
const clone = (v) => JSON.parse(JSON.stringify(v));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const shownTime = v => /^\d{2}:\d{2}(?::00)?$/.test(v || "") ? v.slice(0, 5) : v || "";
export function normalizedDays(days = {}) {
  return Object.fromEntries(DAYS.map(day => [day, (days[day] || []).map(p => ({...p, time: shownTime(p.time)}))]));
}
export function changedDays(before, after) {
  const a = normalizedDays(before), b = normalizedDays(after);
  return Object.fromEntries(DAYS.filter(d => JSON.stringify(a[d]) !== JSON.stringify(b[d])).map(d => [d, clone(b[d])]));
}
export function validateDraft(days, hot, limits = [], maxPeriods = 6, fullWeek = false, allowEmptyDays = !fullWeek || !hot, timeStep = hot ? 10 : null) {
  if (!days || typeof days !== "object" || Array.isArray(days)) return "Days must be an object.";
  if (fullWeek && DAYS.some(d => !Object.hasOwn(days, d))) return "A new timed schedule requires all seven days.";
  for (const [day, periods] of Object.entries(days)) {
    if (!DAYS.includes(day)) return "Unrecognized day.";
    const minimum = allowEmptyDays ? 0 : 1;
    if (!Array.isArray(periods) || periods.length < minimum || periods.length > maxPeriods) return `${day}: enter ${minimum}–${maxPeriods} periods.`;
    let previous = "";
    for (const p of periods) {
      if (!p || typeof p !== "object") return `${day}: invalid period.`;
      const keys = Object.keys(p).sort().join(",");
      if (keys !== (hot ? "state,time" : "temperature,time")) return `${day}: invalid period fields.`;
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(p.time || "")) return `${day}: choose a valid time.`;
      const time = p.time.slice(0, 5);
      if (timeStep && (Number(time.slice(0,2))*60+Number(time.slice(3,5)))%timeStep) return `${day}: times must use ${timeStep}-minute increments.`;
      if (time <= previous) return `${day}: times must be in increasing order without duplicates.`;
      previous = time;
      if (hot) {
        if (!["On", "Off"].includes(p.state)) return `${day}: choose On or Off.`;
      } else {
        if (typeof p.temperature !== "number" || !Number.isFinite(p.temperature)) return `${day}: enter a temperature.`;
        if (typeof limits[0] === "number" && p.temperature < limits[0] || typeof limits[1] === "number" && p.temperature > limits[1]) return `${day}: temperature is outside the thermostat limits.`;
      }
    }
  }
  return "";
}
export function heatingWeekError(days) {
  return DAYS.slice(0,5).some(d=>days[d]?.length) && DAYS.slice(5).some(d=>days[d]?.length) ? "" : "Keep at least one weekday (Monday–Friday) and one weekend day (Saturday or Sunday) with a period. Turn the Heating schedule switch Off to disable scheduling.";
}
export function requiresFullWeek(baseline, hot = false) {
  // Timed is an existing routine, including an empty week returned after
  // deletion. Older backends inferred creation from empty period lists.
  return !!(baseline?.requires_conversion || baseline?.requires_full_week && (hot || baseline?.schedule_type !== "Timed"));
}
export function makeSaveRequest(entity, baseline, draft, confirmConversion = false) {
  if (!/^(climate|water_heater)\.[a-z0-9_]+$/.test(entity || "")) throw new Error("Choose a valid Resideo entity.");
  if (!baseline?.revision || baseline.write_supported === false) throw new Error("Load a supported cloud schedule before saving.");
  const hot = entity.startsWith("water_heater.");
  const full = requiresFullWeek(baseline, hot);
  const days = full ? normalizedDays(draft) : changedDays(baseline.days, draft);
  if (!Object.keys(days).length) throw new Error("There are no changes to save.");
  const error = validateDraft(days, hot, baseline.temperature_limits || [], baseline.max_periods_per_day || 6, full, !full || !hot, baseline.time_step_minutes || (hot ? 10 : null));
  if (error) throw new Error(error);
  if (!hot && heatingWeekError(draft)) throw new Error(heatingWeekError(draft));
  if (baseline.requires_conversion && !confirmConversion) throw new Error("Confirm the switch from geofence to timed schedule.");
  return {type: "call_service", domain: "resideo_native", service: `set_${hot ? "hot_water" : "heating"}_schedule`,
    target: {entity_id: entity}, service_data: {days, expected_revision: baseline.revision,
      ...(baseline.requires_conversion ? {confirm_conversion: true} : {})}, return_response: true};
}
function controlRequest(entity, baseline, service, data) {
  if (!/^climate\.[a-z0-9_]+$/.test(entity || "") || !baseline?.revision || baseline.schedule_controls_supported !== true) throw new Error("Load a supported heating schedule with the current integration first.");
  return {type:"call_service",domain:"resideo_native",service,target:{entity_id:entity},service_data:{expected_revision:baseline.revision,...data},return_response:true};
}
export function makeEnabledRequest(entity, baseline, enabled) {
  const request=controlRequest(entity,baseline,"set_heating_schedule_enabled",{enabled});
  if (typeof enabled!=="boolean" || !["Timed","Geofence","None"].includes(baseline?.schedule_type)) throw new Error("Load a recognized heating schedule status before changing On/Off.");
  return request;
}
export function makeModeRequest(entity, baseline, mode, days, geofence, confirmed) {
  if (!["Timed","Geofence"].includes(mode)) throw new Error("Choose Timed or Geofence.");
  if (!confirmed) throw new Error("Confirm the schedule type change before saving.");
  const request=controlRequest(entity,baseline,"set_heating_schedule_mode",{});
  let data={mode,confirm_change:true};
  if (mode==="Timed") {
    const week=normalizedDays(days),problem=validateDraft(week,false,baseline.temperature_limits || [],6,true,true,baseline.time_step_minutes);
    if (problem || heatingWeekError(week)) throw new Error(problem || heatingWeekError(week));
    data.days=week;
  } else {
    const input={home_temperature:geofence?.home_temperature,away_temperature:geofence?.away_temperature};
    for (const [name,value] of Object.entries(input)) {
      const problem=validateDraft({Monday:[{time:"00:00",temperature:value}]},false,baseline.temperature_limits || []);
      if (problem) throw new Error(`${name==="home_temperature"?"Home":"Away"}: enter a temperature within the thermostat limits.`);
    }
    data.geofence=input;
    if(Object.hasOwn(geofence || {},"sleep")){
      if(geofence.sleep!==null){const problem=sleepDraftError(geofence.sleep,baseline.temperature_limits || [],baseline.time_step_minutes);if(problem)throw new Error(problem);}
      data.geofence.sleep=geofence.sleep===null?null:clone(geofence.sleep);
    }
  }
  request.service_data={...request.service_data,...data};return request;
}

export function sleepDraftError(sleep,limits=[],step=null) {
  if(!sleep || Object.keys(sleep).sort().join(",")!=="end_time,start_time,temperature")return "Enter sleep start, end and temperature.";
  if(![sleep.start_time,sleep.end_time].every(t=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(t || "")))return "Enter valid sleep start and end times.";
  if(sleep.start_time.slice(0,5)===sleep.end_time.slice(0,5))return "Sleep start and end must be different.";
  if(step && [sleep.start_time,sleep.end_time].some(t=>(Number(t.slice(0,2))*60+Number(t.slice(3,5)))%step))return `Sleep times must use ${step}-minute increments.`;
  if(validateDraft({Monday:[{time:"00:00",temperature:sleep.temperature}]},false,limits))return "Enter a sleep temperature within the thermostat limits.";
  return null;
}

const STYLE = `
:host{display:block;color:var(--primary-text-color,#20232b);font:14px/1.5 var(--paper-font-body1_-_font-family,system-ui,sans-serif);--accent:var(--primary-color,#b51b2a);--surface:var(--card-background-color,#fff);--muted:var(--secondary-text-color,#69717f);--line:var(--divider-color,#e3e7ed);--soft:var(--secondary-background-color,#f3f5f8)}
*{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button{cursor:pointer}button:disabled{opacity:.48;cursor:not-allowed}button:focus-visible,input:focus-visible,select:focus-visible{outline:3px solid var(--accent);outline-offset:3px}button{border:1px solid var(--line);background:var(--surface);padding:9px 14px;border-radius:10px;min-height:40px}button:hover:not(:disabled){background:var(--soft)}button.primary{background:var(--accent);border-color:var(--accent);color:var(--text-primary-color,#fff)}button.danger{color:var(--error-color,#b3261e)}button.small{padding:5px 10px;min-height:34px}h1,h2,h3,p{margin:0}h1{font-size:27px;letter-spacing:-.7px}h2{font-size:18px}h3{font-size:15px}.shell{max-width:1140px;margin:auto;padding:28px 24px 40px}.heading{display:flex;gap:14px;align-items:center;margin-bottom:24px}.mark{width:44px;height:44px;border-radius:13px;background:#b51b2a;color:white;display:grid;place-items:center;font-weight:800;font-size:23px}.sub,.muted{color:var(--muted)}.sub{font-size:13px}.panel{background:var(--surface);border:1px solid var(--line);border-radius:17px;padding:20px;margin-bottom:18px}.toolbar{display:flex;gap:12px;flex-wrap:wrap;align-items:end}.toolbar label{flex:1;min-width:230px}.toolbar label span,label.field span{display:block;font-size:12px;color:var(--muted);margin-bottom:5px}select,input{border:1px solid var(--line);border-radius:9px;background:var(--surface);padding:9px 10px;min-height:40px}select{width:100%}.tools{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.badge{white-space:nowrap;display:inline-block;font-size:12px;border-radius:20px;padding:4px 10px;background:var(--soft);color:var(--muted)}.meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:15px}.status{padding:13px 16px;border-radius:11px;margin-bottom:18px;background:var(--soft);white-space:pre-wrap;overflow-wrap:anywhere}.status.error{background:var(--error-state-color-bg,#fcebea);color:var(--error-color,#b3261e)}.status.warning{background:var(--warning-color-bg,#fff8e1);color:var(--primary-text-color,#20232b)}.status.success{background:var(--success-state-color-bg,#e8f5eb);color:var(--success-color,#22703a)}.layout{display:grid;grid-template-columns:minmax(235px,.85fr) minmax(340px,1.6fr);gap:18px}.week{padding:10px}.day{width:100%;text-align:left;display:block;border:1px solid transparent;border-radius:11px;margin:3px 0;padding:12px}.day.active{border-color:var(--accent);background:var(--soft)}.day-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}.day-head strong{font-size:14px}.dot{font-size:11px;color:var(--accent)}.summary{color:var(--muted);font-size:11px}.bar{height:6px;border-radius:4px;overflow:hidden;display:flex;background:var(--soft);margin:8px 0}.bar i{display:block;min-width:1px}.period-head>div{min-width:0;flex:1}.period-head>.badge{flex:none}.period-head{display:flex;justify-content:space-between;gap:10px;align-items:start;margin-bottom:18px}.period-row{display:grid;grid-template-columns:27px minmax(110px,1fr) minmax(105px,1fr) 36px;gap:10px;align-items:end;margin:12px 0}.num{align-self:center;color:var(--muted);font-size:12px}input{width:100%}.delete{padding:4px;font-size:19px}.empty{padding:32px 8px;text-align:center;color:var(--muted)}.copy{border-top:1px solid var(--line);margin-top:23px;padding-top:16px}.copy p{font-size:12px;color:var(--muted);margin-top:3px}.checks{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.checks label,.confirm{display:flex;align-items:center;gap:7px}.checks input,.confirm input{width:auto;min-height:0;accent-color:var(--accent)}.footer{display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:18px;margin-top:20px}.footer p{font-size:12px;color:var(--muted)}.actions{display:flex;gap:8px;flex-wrap:wrap}.explain{margin-bottom:16px;color:var(--muted);font-size:13px}.notice{border-left:3px solid var(--accent);padding:10px 13px;background:var(--soft);margin-bottom:16px}.review{position:fixed;inset:0;z-index:20;background:#0007;display:flex;align-items:center;justify-content:center;padding:20px}.modal{background:var(--surface);border-radius:18px;max-height:90vh;overflow:auto;width:700px;max-width:100%;padding:24px;box-shadow:0 20px 80px #0004}.modal h2{margin-bottom:8px}.reviewday{border-top:1px solid var(--line);padding:13px 0}.reviewgrid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:6px}.reviewgrid span{font-size:12px;color:var(--muted)}.reviewgrid pre{font:12px/1.65 system-ui;margin:4px 0;white-space:pre-wrap}.confirm{margin:16px 0;align-items:start}.file{display:none}code{font-size:12px;overflow-wrap:anywhere}.mobile-head{display:flex;align-items:center;gap:10px}.menu{display:none}
@media(max-width:750px){.shell{padding:18px 12px 30px}.layout{grid-template-columns:1fr}.week{display:flex;overflow:auto;padding:8px}.day{min-width:95px;flex:1;margin:0 2px;padding:9px}.day .summary,.day .bar{display:none}.day-head{display:flex;flex-direction:column;align-items:flex-start;gap:3px;margin:0}.day-head strong{font-size:12px}.panel{padding:16px}.week.panel{padding:8px}.period-row{gap:7px;grid-template-columns:20px minmax(100px,1fr) minmax(90px,1fr) 32px}.toolbar label{min-width:100%;flex-basis:100%}.review{padding:10px}.modal{padding:18px}.heading{margin-bottom:16px}h1{font-size:23px}.menu{display:block}.reviewgrid{grid-template-columns:1fr 1fr}}
`;

const ElementBase = globalThis.HTMLElement || class {};
export class ResideoScheduleEditor extends ElementBase {
  constructor() {
    super();
    this.attachShadow({mode: "open"});
    this._entities = []; this._selected = new URLSearchParams(globalThis.location?.search || "").get("entity") || ""; this._day = DAYS[0]; this._targets = new Set();
    this._baseline = null; this._draft = {}; this._busy = false; this._message = "";
    this._messageType = ""; this._review = false; this._conversionConfirmed = false;
    this._newDraft = false; this._nonce = 0; this._loadedEntities = false;
    this._targetMode=null; this._geoDraft={}; this._enabledReview=null; this._uncertain=false;
    this._sleepEditing=false;this._sleepDraft={};
    this._entryByEntity=new Map(); this._entryFilter=new URLSearchParams(globalThis.location?.search || "").get("config_entry") || "";
    this._optionsForm=null; this._optionsValues={};
    this._sidebarByEntry=new Map(); this._sidebarLoading=null;
    const requestedMode=new URLSearchParams(globalThis.location?.search || "").get("mode");
    this._requestedMode=["Timed","Geofence"].includes(requestedMode)?requestedMode:null;
    this.shadowRoot.addEventListener("click", e => this._onClick(e));
    this.shadowRoot.addEventListener("change", e => this._onChange(e));
    this.shadowRoot.addEventListener("input", e => {
      if (e.target.dataset.field) this._updatePeriod(e.target);
      if (e.target.dataset.geo) this._geoDraft[e.target.dataset.geo]=e.target.value.trim()===""?null:Number(e.target.value);
      if (e.target.dataset.sleep) this._sleepDraft[e.target.dataset.sleep]=e.target.dataset.sleep==="temperature"?(e.target.value.trim()===""?null:Number(e.target.value)):e.target.value;
    });
    this.shadowRoot.addEventListener("keydown", e => {
      if (!this._review) return;
      if (e.key === "Escape" && !this._busy) {this._review = false; this._enabledReview=null; this.render(); return;}
      if (e.key === "Tab") {
        const elements = [...this.shadowRoot.querySelectorAll('.modal button:not(:disabled), .modal input:not(:disabled)')];
        const first = elements[0], last = elements.at(-1), active = this.shadowRoot.activeElement;
        if (e.shiftKey && (active === first || !elements.includes(active))) {e.preventDefault(); last?.focus();}
        else if (!e.shiftKey && (active === last || !elements.includes(active))) {e.preventDefault(); first?.focus();}
      }
    });
  }
  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Editor configuration is required.");
    this._config = config; this._selected = config.entity || this._selected;
    this._entryFilter=config.config_entry || this._entryFilter;
    if(["Timed","Geofence"].includes(config.mode))this._requestedMode=config.mode;
    this.render();
  }
  get canClose(){return !this._busy;}
  getCardSize() {return 10;}
  set hass(value) {
    this._hass = value;
    if (this.isConnected && !this._loadedEntities && !this._loadingEntities) this._fetchEntities();
  }
  get hass() {return this._hass;}
  connectedCallback() {this.render(); if (this._hass && !this._loadedEntities) this._fetchEntities();}
  disconnectedCallback() {
    this._nonce++; this._busy = false; this._loadingEntities = false;
    const flow=this._optionsForm;this._optionsForm=null;
    if(flow?.flow_id && this._hass?.callApi)void this._hass.callApi("DELETE",`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});
  }
  get hot() {return this._selected.startsWith("water_heater.");}
  get fullWeek() {return requiresFullWeek(this._baseline, this.hot) || this._targetMode==="Timed" && this._baseline?.schedule_type!=="Timed";}
  get dirty() {return !!this._baseline?.revision && (this._targetMode && this._targetMode!==this._baseline.schedule_type || this._targetMode==="Geofence" && JSON.stringify(this._geoDraft)!==JSON.stringify(this._geoValues(this._baseline.geofence_settings)) || this._newDraft || Object.keys(changedDays(this._baseline.days, this._draft)).length > 0);}
  _geoValues(profile){return {home_temperature:profile?.home_temperature ?? null,away_temperature:profile?.away_temperature ?? null,...(profile?.sleep?{sleep:clone(profile.sleep)}:{})};}
  _stateName(id) {return this._hass?.states?.[id]?.attributes?.friendly_name || id;}
  async _fetchEntities() {
    if (!this._hass?.connection) return;
    this._loadingEntities = true;
    try {
      const list = await this._hass.connection.sendMessagePromise({type:"config/entity_registry/list"});
      const own=list.filter(e=>e.platform==="resideo_native" && !e.disabled_by && /^(climate|water_heater)\./.test(e.entity_id) && (!this._entryFilter || e.config_entry_id===this._entryFilter));
      this._entryByEntity=new Map(own.map(e=>[e.entity_id,e.config_entry_id]));
      this._entities = own.map(e=>e.entity_id).sort((a,b) => this._stateName(a).localeCompare(this._stateName(b)));
      this._loadedEntities = true;
      if (this._selected && !this._entities.includes(this._selected)) this._selected = "";
      if (!this._selected && this._entities.length === 1) this._selected = this._entities[0];
      this.render();
      void this._loadSidebar();
      if (this._selected && !this._baseline) await this.loadSchedule();
    } catch (e) {this._message = `Could not list Resideo entities: ${e.message || e}`; this._messageType = "error"; this.render();}
    finally {this._loadingEntities = false;}
  }
  async _call(request) {
    const result = await this._hass.connection.sendMessagePromise(request);
    const response = result?.response?.[this._selected];
    if (!response || typeof response !== "object") throw new Error("Home Assistant returned no schedule response. Check the integration version and log.");
    return response;
  }
  async loadSchedule(discard = false) {
    if (!this._selected || this._busy) return;
    if (this.dirty && !discard) {this._message = "You have unsaved edits. Use Discard & reload to fetch the cloud schedule."; this._messageType = "error"; this.render(); return;}
    const nonce = ++this._nonce;
    this._busy = true; this._message = ""; this._review = false; this.render();
    try {
      const schedule = await this._call({type:"call_service", domain:"resideo_native", service:`get_${this.hot ? "hot_water" : "heating"}_schedule`, target:{entity_id:this._selected}, service_data:{}, return_response:true});
      if (nonce !== this._nonce) return;
      this._baseline = clone(schedule); this._draft = normalizedDays(schedule.days);
      this._newDraft = false; this._conversionConfirmed = false;
      this._targetMode=null; this._enabledReview=null; this._uncertain=false;
      this._geoDraft=this._geoValues(schedule.geofence_settings);this._sleepEditing=false;
      if (!schedule.revision || schedule.status === "unrecognized_response") {
        this._message = `${schedule.message || "The cloud returned an unsupported schedule."}\n${JSON.stringify(schedule.response_structure || {})}`;
        this._messageType = "error";
      } else {this._message = "Loaded from Resideo. Changes stay in this draft until you save."; this._messageType = "";}
    } catch (e) {if (nonce === this._nonce) {this._message = `${e.message || e}`; this._messageType = "error";}}
    finally {if (nonce === this._nonce) {this._busy = false; this.render();}}
    if(this._requestedMode && !this.hot && this._baseline?.revision && this._baseline.schedule_controls_supported && this._baseline.write_supported!==false){
      const mode=this._requestedMode;this._requestedMode=null;this._chooseMode(mode);
    }
  }
  _summary(periods) {return (periods || []).map(p => `${shownTime(p.time)} ${this.hot ? p.state || "—" : `${p.temperature ?? "—"}°`}`).join(" · ") || "No timed periods";}
  _bar(periods) {
    const items = (periods || []).filter(p => /^(?:[01]\d|2[0-3]):[0-5]\d/.test(p.time || ""));
    if (!items.length) return "";
    const at = p => Number(p.time.slice(0,2))*60 + Number(p.time.slice(3,5));
    let html = "";
    if (at(items[0]) > 0) html += `<i style="width:${at(items[0])/14.4}%;background:var(--soft)"></i>`;
    items.forEach((p,i) => {const span = Math.max(0,(i+1 < items.length ? at(items[i+1]) : 1440)-at(p));
      const alpha = this.hot ? (p.state === "On" ? .9 : .14) : Math.min(.95,Math.max(.2,(Number(p.temperature)||0)/35));
      html += `<i style="width:${span/14.4}%;background:var(--accent);opacity:${alpha}"></i>`;
    }); return `<div class="bar" aria-hidden="true">${html}</div>`;
  }
  render() {
    if (!this.shadowRoot) return;
    if(this._config?.dialog && this._review){this.shadowRoot.innerHTML=`<style>${STYLE}.review{position:static;display:block;background:transparent;padding:0}.modal{width:100%;max-height:none;padding:8px;box-shadow:none}</style>${this._reviewHTML()}`;return;}
    if(this._config?.dialog && !this._baseline?.revision){this.shadowRoot.innerHTML=`<style>${STYLE}</style><p role="status">${esc(this._message || "Loading the current schedule…")}</p><button data-action="load" ${this._busy?"disabled":""}>Load from Resideo</button>`;return;}
    const b = this._baseline, ready = b?.revision && b.write_supported !== false;
    const editable = ready && this._targetMode!=="Geofence" && (!this.fullWeek || this._newDraft);
    const unit = b?.temperature_unit === "Fahrenheit" ? "°F" : "°C";
    const changed = b?.revision ? changedDays(b.days, this._draft) : {};
    const periods = this._draft[this._day] || [];
    const disabled = this._busy ? "disabled" : "";
    this.shadowRoot.innerHTML = `<style>${STYLE}${this._config?.dialog?".heading,.shell>section:first-of-type,.meta,.shell>p.sub{display:none}.shell{padding:0;max-width:none}":""}</style><div class="shell">
      <header class="heading"><button class="menu" data-action="menu" aria-label="Open Home Assistant menu">☰</button><div class="mark" aria-hidden="true">r</div><div><h1>${esc(this._config?.title || "Resideo schedules")}</h1><p class="sub">Your cloud routine, editable in Home Assistant · <span data-editor-version>Editor ${EDITOR_VERSION}</span></p></div></header>
      <section class="panel"><div class="toolbar"><label><span>THERMOSTAT OR HOT WATER</span><select id="entity" aria-label="Select Resideo device" ${disabled}><option value="">Choose a device…</option>${this._entities.map(id => `<option value="${esc(id)}" ${id === this._selected ? "selected" : ""}>${esc(this._stateName(id))} · ${id.startsWith("water_heater.") ? "Hot water" : "Heating"}</option>`).join("")}</select></label><button data-action="load" ${!this._selected || this._busy || this.dirty ? "disabled" : ""}>${this._busy ? "Working…" : "Load from Resideo"}</button><button data-action="discard" ${!this.dirty && !this._uncertain ? "hidden" : ""} ${disabled}>Discard & reload</button></div>
      <div class="tools"><button class="small" data-action="entities" ${disabled}>Refresh device list</button><button class="small" data-action="export" ${!b?.revision || !Object.values(b.days || {}).some(p=>p.length) || b.requires_conversion || this._busy ? "disabled" : ""}>Export cloud backup</button><button class="small" data-action="import" ${!ready || this._busy ? "disabled" : ""}>Import backup into draft</button><button class="small" data-action="settings" ${this._busy || this._optionsForm || this._sidebarLoading ? "disabled" : ""}>Integration settings</button><input id="file" class="file" type="file" accept="application/json,.json"></div>
      <div class="tools"><button class="small ${this._sidebarByEntry.get(this._settingsEntry())===true ? "primary" : ""}" data-action="sidebar" role="switch" aria-label="Add scheduler to sidebar" aria-checked="${this._sidebarByEntry.get(this._settingsEntry())===true}" ${this._busy || this._optionsForm || this._sidebarLoading || this.dirty || this._uncertain || !this._settingsEntry() || !this._hass?.callApi ? "disabled" : ""}>Add scheduler to sidebar <span aria-hidden="true">· ${this._sidebarLoading ? "Loading…" : this._sidebarByEntry.has(this._settingsEntry()) ? this._sidebarByEntry.get(this._settingsEntry()) ? "On" : "Off" : "Check setting"}</span></button></div><p class="sub">Optional, off by default. Saves this account’s preference for Home Assistant users. With multiple accounts, the shortcut stays visible while any account enables it.</p></section>
      ${this._message ? `<div role="status" aria-live="polite" class="status ${esc(this._messageType)}">${esc(this._message)}</div>` : ""}
      ${this._optionsForm ? this._optionsHTML() : ""}
      ${!this._entities.length && this._loadedEntities ? `<section class="panel empty">No Resideo climate or hot-water entities are enabled. A hot-water editor appears only for a reported DHW zone.</section>` : ""}
      ${b?.revision ? `<div class="meta"><span class="badge">${this.hot ? "Hot water" : "Heating"}</span><span class="badge">Cloud mode: ${esc(b.schedule_type || (this.hot ? "Timed" : "Unknown"))}</span><span class="badge">Thermostat-local time${this.hot ? "" : ` · ${unit}`}</span><span class="badge" data-draft-status>${this.dirty ? "Unsaved draft" : "Cloud data loaded"}</span></div>
      ${b.write_supported === false ? `<div class="notice">${b.schedule_content_refreshed===false?"Native On/Off was confirmed. Load from Resideo again before editing the stored routine.":"This schedule type can be viewed but is not supported for editing or conversion. No changes will be sent."}</div>` : ""}
      ${!this.hot && ready && b.schedule_controls_supported ? this._controlsHTML() : ""}
      ${!this.hot && b.schedule_enabled===false && b.schedule_type==="None" ? `<p class="notice">Scheduling is off. Use Turn schedule on above to resume the stored routine. It may be hidden while scheduling is off.</p>` : ""}
      ${this.fullWeek && !this._newDraft && this._targetMode!=="Geofence" ? `<section class="panel"><h2>${b.requires_conversion ? "Geofence schedule is selected" : "No active timed routine"}</h2><p class="explain">${this.hot ? "Start with a blank week and enter your own On/Off transitions for each day." : "Start with your own timed routine. Keep at least one weekday and one weekend day with periods; the other days may be empty."} Nothing changes until you review and save.</p><button class="primary" data-action="new" ${!ready || this._busy ? "disabled" : ""}>Create timed schedule</button></section>` : ""}
      ${editable ? `<div class="layout"><nav class="panel week" aria-label="Days">${DAYS.map(d=>`<button class="day ${d===this._day ? "active" : ""}" aria-pressed="${d===this._day}" data-day="${d}" ${disabled}><div class="day-head"><strong>${d}</strong>${this._newDraft || changed[d] ? `<span class="dot">Edited</span>` : ""}</div>${this._bar(this._draft[d])}<div class="summary">${esc(this._summary(this._draft[d]))}</div></button>`).join("")}</nav>
      <section class="panel"><div class="period-head"><div><h2>${this._day}</h2><p class="sub">${this.hot ? "On/Off transitions in 10-minute increments; each state lasts until the next transition." : "Temperature takes effect at each time until the next period."}</p></div><span class="badge">${periods.length} / ${b.max_periods_per_day || 6}</span></div>
      ${!periods.length ? `<p class="empty">No timed changes on this day. Add a period or copy another day.</p>` : ""}
      ${periods.map((p,i)=>`<div class="period-row"><span class="num">${i+1}</span><label class="field"><span>Start time</span><input type="time" step="${(b.time_step_minutes || (this.hot ? 10 : 1))*60}" value="${esc(shownTime(p.time))}" data-index="${i}" data-field="time" aria-label="Period ${i+1} start time" ${disabled}></label>${this.hot ? `<label class="field"><span>Hot water</span><select data-index="${i}" data-field="state" aria-label="Period ${i+1} state" ${disabled}><option value="">Choose…</option><option value="On" ${p.state==="On" ? "selected" : ""}>On</option><option value="Off" ${p.state==="Off" ? "selected" : ""}>Off</option></select></label>` : `<label class="field"><span>Temperature ${unit}</span><input type="number" step="${b.temperature_unit==="Fahrenheit" ? "1" : "0.5"}" ${typeof b.temperature_limits?.[0] === "number" ? `min="${esc(b.temperature_limits[0])}"` : ""} ${typeof b.temperature_limits?.[1] === "number" ? `max="${esc(b.temperature_limits[1])}"` : ""} value="${esc(p.temperature)}" data-index="${i}" data-field="temperature" aria-label="Period ${i+1} temperature" ${disabled}></label>`}<button class="delete danger" data-action="delete" data-index="${i}" aria-label="Remove period ${i+1}" ${disabled}>×</button></div>`).join("")}
      <button data-action="add" ${this._busy || periods.length >= (b.max_periods_per_day || 6) ? "disabled" : ""}>+ Add period</button>
      <div class="copy"><h3>Copy ${this._day} to other days</h3><p>Replaces only the selected days in your draft. Review before saving.</p><div class="tools"><button class="small" data-action="weekdays" ${disabled}>Weekdays</button><button class="small" data-action="weekend" ${disabled}>Weekend</button><button class="small" data-action="all" ${disabled}>All other days</button></div><div class="checks">${DAYS.filter(d=>d!==this._day).map(d=>`<label><input type="checkbox" data-copy="${d}" ${this._targets.has(d) ? "checked" : ""} ${disabled}>${d.slice(0,3)}</label>`).join("")}</div><button data-action="copy" ${this._busy || !this._targets.size ? "disabled" : ""}>Copy periods</button></div>
      </section></div><div class="panel footer"><p>Changes are local until saved.<br>Saving updates the same cloud schedule used by the Resideo app.</p><button class="primary" data-action="review" ${!this.dirty || this._busy || this._uncertain ? "disabled" : ""}>Review & save</button></div>` : ""}
      <p class="sub">Schedules load on demand. Refresh to import app-side changes. Reading or editing a schedule does not itself change the thermostat’s current mode or hold.</p>` : `<section class="panel empty">Choose a Resideo device and load its schedule to begin.</section>`}
      ${this._review ? this._reviewHTML() : ""}
    </div>`;
  }
  _sleepHTML() {
    const b=this._baseline,sleep=this._geoDraft.sleep,existing=b.geofence_settings?.has_sleep && !Object.hasOwn(this._geoDraft,"sleep"),disabled=this._busy?"disabled":"";
    if(this._sleepEditing)return `<section class="panel" role="group" aria-label="Sleep settings"><h3>Sleep settings</h3><div class="toolbar">${[["start_time","Sleep start"],["end_time","Sleep end"]].map(([key,label])=>`<label class="field"><span>${label}</span><input type="time" step="${(b.time_step_minutes || 1)*60}" data-sleep="${key}" aria-label="${label}" value="${esc(shownTime(this._sleepDraft[key]))}" ${disabled}></label>`).join("")}<label class="field"><span>Night temperature (${b.temperature_unit==="Fahrenheit"?"°F":"°C"})</span><input type="number" step="${b.temperature_unit==="Fahrenheit"?1:.5}" data-sleep="temperature" aria-label="Night temperature" value="${esc(this._sleepDraft.temperature)}" ${disabled}></label></div><p class="sub">Sleep can continue past midnight. It applies while you are home.</p><div class="tools"><button data-action="sleep-cancel" ${disabled}>Cancel sleep edit</button><button data-action="sleep-save" ${disabled}>Save sleep settings</button></div></section>`;
    return `<section class="panel"><h3>Sleep settings</h3>${sleep?`<p>Sleep start ${esc(shownTime(sleep.start_time))} · Sleep end ${esc(shownTime(sleep.end_time))} · Heat to ${esc(sleep.temperature)}°</p>`:existing?'<p class="sub">Existing sleep settings are preserved. Create settings to replace the returned profile.</p>':'<p class="sub">No sleep settings in this draft.</p>'}<div class="tools"><button data-action="${sleep?"sleep-edit":"sleep-create"}" ${disabled}>${sleep?"Edit sleep settings":"Create Sleep Settings"}</button>${sleep || existing?`<button data-action="sleep-remove" ${disabled}>Remove sleep settings</button>`:""}</div></section>`;
  }
  _controlsHTML() {
    const b=this._baseline,mode=this._targetMode || b.schedule_type,disabled=this._busy?"disabled":"";
    if(this._config?.dialog && mode==="Timed")return "";
    const blocked=this._busy || this.dirty || this._uncertain || !["Timed","Geofence","None"].includes(b.schedule_type);
    const controls=this._config?.dialog?"":`<div class="tools">${b.schedule_type!=="Geofence"?`<button data-action="mode-geofence" ${this._busy || this.dirty || this._uncertain?"disabled":""}>Switch to Geofencing</button>`:`<button data-action="mode-timed" ${this._busy || this.dirty || this._uncertain?"disabled":""}>Switch to timed schedule</button><button data-action="mode-geofence" ${disabled}>Edit Geofencing settings</button>`}</div><div class="toolbar"><div><p class="sub">Schedule: ${b.schedule_enabled===true?"On":b.schedule_enabled===false?"Off":"status not reported"}</p><div class="tools" role="group" aria-label="Schedule On/Off"><button data-action="schedule-on" ${blocked || b.schedule_enabled===true?"disabled":""}>Turn schedule on</button><button data-action="schedule-off" ${blocked || b.schedule_enabled===false?"disabled":""}>Turn schedule off</button></div></div><label><span>Schedule type</span><select id="schedule-mode" aria-label="Schedule type" ${disabled}>${b.schedule_type==="None"?'<option value="None" disabled>No schedule configured</option>':""}<option value="Timed" ${mode==="Timed"?"selected":""}>Timed</option><option value="Geofence" ${mode==="Geofence"?"selected":""}>Geofence</option></select></label></div><p class="sub">Schedule On/Off retains its periods. Manual holds and heating mode are separate controls.</p><p class="sub">When editing a timed routine, keep at least one weekday and one weekend day with periods.</p>`;
    return `<section class="panel"><h2>${this._config?.dialog?"Home and Away temperatures":"Schedule controls"}</h2>${controls}${this._targetMode==="Geofence"?`<div class="notice">Phone geofencing must be configured in the Resideo app. Export a timed backup before switching; the cloud may omit the inactive routine.</div><div class="toolbar">${[["home_temperature","Home"],["away_temperature","Away"]].map(([key,label])=>`<label class="field"><span>${label} temperature (${b.temperature_unit==="Fahrenheit"?"°F":"°C"})</span><input type="number" step="${b.temperature_unit==="Fahrenheit"?"1":"0.5"}" data-geo="${key}" aria-label="${label} geofence temperature" value="${esc(this._geoDraft[key])}" ${disabled}></label>`).join("")}</div>${this._sleepHTML()}<div class="footer"><span class="sub">Draft only until saved.</span><button class="primary" data-action="review" ${this._busy || this._sleepEditing?"disabled":""}>Review & save</button></div>`:""}</section>`;
  }
  _reviewHTML() {
    const b = this._baseline, days = this.fullWeek ? this._draft : changedDays(b.days, this._draft);
    const changing=!!this._targetMode && this._targetMode!==b.schedule_type;
    let content;
    if(this._enabledReview!==null) content=`<p class="notice">${this._enabledReview?"Turn this thermostat’s native schedule On.":"Turn this thermostat’s native schedule Off."} The saved routine is retained.</p>`;
    else if(this._targetMode==="Geofence") content=`<div class="reviewday"><strong>Geofence temperatures</strong><p>Home: ${esc(this._geoDraft.home_temperature)}° · Away: ${esc(this._geoDraft.away_temperature)}°</p><p class="sub">${this._geoDraft.sleep?`Sleep: ${esc(shownTime(this._geoDraft.sleep.start_time))} → ${esc(shownTime(this._geoDraft.sleep.end_time))}, ${esc(this._geoDraft.sleep.temperature)}°.`:Object.hasOwn(this._geoDraft,"sleep")?"Sleep settings will be removed.":b.geofence_settings?.has_sleep?"Existing sleep settings are preserved.":"No sleep period is added."} Phone geofencing continues to use the official app.</p></div>`;
    else content=DAYS.filter(d=>Object.hasOwn(days,d)).map(d=>`<div class="reviewday"><strong>${d}</strong><div class="reviewgrid"><div><span>Cloud before</span><pre>${esc(this._summary(b.days?.[d]))}</pre></div><div><span>Draft after</span><pre>${esc(this._summary(days[d]))}</pre></div></div>${!days[d].length && b.days?.[d]?.length ? `<p class="notice">All periods on ${d} will be removed. ${this.hot?"Other days are preserved.":"The remaining week keeps a weekday and a weekend day."}</p>` : ""}</div>`).join("");
    return `<div class="review"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="review-title" tabindex="-1"><h2 id="review-title">Review cloud changes</h2><p class="explain">${esc(this._stateName(this._selected))}${changing?` · ${esc(b.schedule_type)} → ${esc(this._targetMode)}`:""}. Nothing has been sent yet.</p>${content}
      ${changing ? `<label class="confirm"><input id="confirm-conversion" type="checkbox" ${this._conversionConfirmed ? "checked" : ""} ${this._busy ? "disabled" : ""}><span>I confirm changing this thermostat to ${esc(this._targetMode)} scheduling.</span></label>` : ""}
      <p class="sub">The cloud revision is checked again before saving. Avoid editing in the app while this request is running.</p><div class="footer"><button data-action="close-review" ${this._busy ? "disabled" : ""}>Back to draft</button><button class="primary" data-action="save" ${this._busy || changing && !this._conversionConfirmed ? "disabled" : ""}>${this._busy ? "Saving…" : "Save to Resideo"}</button></div></section></div>`;
  }
  _chooseMode(mode) {
    if(this._busy || this._uncertain)return;
    if(this.dirty){this._message="Save or discard the draft before changing schedule type.";this._messageType="error";this.render();return;}
    if(mode===this._baseline.schedule_type && mode!=="Geofence")return;
    this._targetMode=mode;this._conversionConfirmed=false;
    if(mode==="Timed"){this._draft=normalizedDays(this._baseline.days);this._newDraft=true;}
    this._message="Schedule type changed in your draft only. Review before saving.";this._messageType="";this.render();
  }
  async _onChange(e) {
    const t = e.target;
    if (t.id === "entity") {
      if (this.dirty || this._optionsForm) {t.value=this._selected; this._message="Save/discard the draft and close integration settings before switching devices."; this._messageType="error"; this.render(); return;}
      this._nonce++; this._selected=t.value; this._baseline=null; this._draft={}; this._targets.clear(); this._newDraft=false; this._message=""; this.render();
      void this._loadSidebar();
      if(this._selected) await this.loadSchedule(); return;
    }
    if(t.id==="schedule-mode") return this._chooseMode(t.value);
    if(t.dataset.option){this._optionsValues[t.dataset.option]=t.type==="checkbox"?t.checked:t.dataset.option==="poll_interval"?Number(t.value):t.value;return;}
    if (t.id === "file") {await this._importFile(t.files?.[0]); return;}
    if (t.id === "confirm-conversion") {this._conversionConfirmed=t.checked; this.render(); return;}
    if (t.dataset.copy) {t.checked ? this._targets.add(t.dataset.copy) : this._targets.delete(t.dataset.copy); this.render(); return;}
    if (t.dataset.field && !this._busy) this._updatePeriod(t);
  }
  _updatePeriod(t) {
    if (this._busy) return;
    const p = this._draft[this._day]?.[Number(t.dataset.index)]; if (!p) return;
    p[t.dataset.field] = t.dataset.field === "temperature" ? (t.value.trim() === "" ? null : Number(t.value)) : t.value;
    // Update indicators without replacing the focused input while typing.
    this.shadowRoot.querySelectorAll("[data-draft-status]").forEach(el => {el.textContent = this.dirty ? "Unsaved draft" : "Cloud data loaded";});
    const review = this.shadowRoot.querySelector('[data-action="review"]'); if (review) review.disabled = !this.dirty;
    const load = this.shadowRoot.querySelector('[data-action="load"]'); if (load) load.disabled = this.dirty;
    const sidebar = this.shadowRoot.querySelector('[data-action="sidebar"]'); if (sidebar) sidebar.disabled = this.dirty || this._uncertain || !!this._sidebarLoading || !!this._optionsForm;
    const discard = this.shadowRoot.querySelector('[data-action="discard"]'); if (discard) discard.hidden = !this.dirty;
    const day = this.shadowRoot.querySelector(`[data-day="${this._day}"]`);
    if(day) {
      const summary = day.querySelector('.summary'); if(summary) summary.textContent=this._summary(this._draft[this._day]);
      day.querySelector('.bar')?.remove();
      const summaryEl=day.querySelector('.summary'); if(summaryEl) summaryEl.insertAdjacentHTML('beforebegin',this._bar(this._draft[this._day]));
      const head=day.querySelector('.day-head'); const dot=head?.querySelector('.dot');
      const changed=this._newDraft || changedDays(this._baseline.days,this._draft)[this._day];
      if(changed && !dot) head?.insertAdjacentHTML('beforeend','<span class="dot">Edited</span>');
      if(!changed) dot?.remove();
    }
  }

  async _onClick(e) {
    const button=e.target.closest("button"); if(!button || button.disabled) return;
    if(button.dataset.day) {this._day=button.dataset.day; this._targets.clear(); this.render(); return;}
    const a=button.dataset.action;
    if(a==="menu") {this.dispatchEvent(new CustomEvent("hass-toggle-menu",{bubbles:true,composed:true})); return;}
    if(a==="load") return this.loadSchedule();
    if(a==="discard") return this.loadSchedule(true);
    if(a==="entities") {this._loadedEntities=false; return this._fetchEntities();}
    if(a==="settings")return this._openOptions();
    if(a==="sidebar")return this._toggleSidebar();
    if(a==="settings-cancel")return this._cancelOptions();
    if(a==="settings-save")return this._saveOptions();
    if(a==="mode-geofence")return this._chooseMode("Geofence");
    if(a==="mode-timed")return this._chooseMode("Timed");
    if(a==="sleep-create" || a==="sleep-edit"){this._sleepDraft=clone(this._geoDraft.sleep || {start_time:"",end_time:"",temperature:null});this._sleepEditing=true;this.render();return;}
    if(a==="sleep-cancel"){this._sleepEditing=false;this.render();return;}
    if(a==="sleep-remove"){this._geoDraft.sleep=null;this._sleepEditing=false;this.render();return;}
    if(a==="sleep-save"){
      const problem=sleepDraftError(this._sleepDraft,this._baseline.temperature_limits || [],this._baseline.time_step_minutes);
      if(problem){this._message=problem;this._messageType="error";}else{this._geoDraft.sleep=clone(this._sleepDraft);this._sleepEditing=false;this._message="Sleep settings saved in your draft. Review and save the profile to apply them.";this._messageType="";}
      this.render();return;
    }
    if(a==="new") {this._draft=Object.fromEntries(DAYS.map(d=>[d,[]])); this._newDraft=true; if(!this.hot)this._targetMode="Timed";this._message=this.hot?"Blank draft created. Add your own transitions to all seven days.":"Blank draft created. Add your own periods to at least one weekday and one weekend day."; this._messageType=""; this.render(); return;}
    if(a==="schedule-on" || a==="schedule-off"){
      if(this.dirty){this._message="Save or discard the draft before changing schedule On/Off.";this._messageType="error";this.render();return;}
      this._enabledReview=a==="schedule-on";
      try{this._buildRequest(true);this._review=true;this._message="";}catch(err){this._enabledReview=null;this._message=err.message;this._messageType="error";}
    }
    if(a==="add") {this._draft[this._day].push(this.hot ? {time:"",state:""} : {time:"",temperature:null});}
    if(a==="delete") this._draft[this._day].splice(Number(button.dataset.index),1);
    if(["weekdays","weekend","all"].includes(a)) this._targets=new Set(DAYS.filter((d,i)=>d!==this._day && (a==="all" || a==="weekdays" && i<5 || a==="weekend" && i>=5)));
    if(a==="copy") {
      const problem=validateDraft({[this._day]:this._draft[this._day]},this.hot,this._baseline.temperature_limits || [],6,false,!this.hot || !this.fullWeek,this._baseline.time_step_minutes || (this.hot ? 10 : null));
      if(problem) {this._message=problem; this._messageType="error";} else {for(const d of this._targets) this._draft[d]=clone(this._draft[this._day]); this._targets.clear(); this._message="Copied to selected days in your draft."; this._messageType="";}
    }
    if(a==="review") {
      try {this._buildRequest(true); this._review=true; this._message="";}
      catch(err) {this._message=err.message; this._messageType="error";}
    }
    if(a==="close-review") {this._review=false;this._enabledReview=null;}
    if(a==="save") return this.saveSchedule();
    if(a==="export") {this._exportBackup(); return;}
    if(a==="import") {this.shadowRoot.getElementById("file").click(); return;}
    this.render();
    if(this._review) this.shadowRoot.querySelector(".modal")?.focus();
  }
  _buildRequest(confirmed) {
    if(this._uncertain)throw new Error("Check the app and reload before sending another write. The last write was accepted but unconfirmed.");
    if(this._sleepEditing)throw new Error("Save or cancel the sleep settings before reviewing the profile.");
    if(this._enabledReview!==null)return makeEnabledRequest(this._selected,this._baseline,this._enabledReview);
    if(this._targetMode && (this._targetMode==="Geofence" || this._targetMode!==this._baseline.schedule_type))return makeModeRequest(this._selected,this._baseline,this._targetMode,this._draft,this._geoDraft,confirmed || this._targetMode===this._baseline.schedule_type);
    return makeSaveRequest(this._selected,this._baseline,this._draft,confirmed);
  }
  async saveSchedule() {
    if(this._busy) return;
    let request;
    try {request=this._buildRequest(this._conversionConfirmed);}
    catch(err) {this._message=err.message; this._messageType="error"; this._review=false; this.render(); return;}
    const nonce=++this._nonce; this._busy=true; this.render();
    try {
      const result=await this._call(request);
      if(nonce!==this._nonce) return;
      if(result.status==="readback_unconfirmed") {
        this._uncertain=true;this._review=false;this._enabledReview=null;
        this._message=`${result.message}\n${result.mismatched_days?.length?`Not yet confirmed: ${result.mismatched_days.join(", ")}. `:""}Your draft is retained. Discard & reload after checking the app.`;
        this._messageType="warning";return;
      }
      if(!result.revision || result.status==="unrecognized_response") throw new Error("No confirmed schedule readback. Check the app and load again before retrying.");
      this._baseline=clone(result); this._draft=normalizedDays(result.days); this._newDraft=false;
      this._targetMode=null;this._enabledReview=null;this._geoDraft=this._geoValues(result.geofence_settings);this._sleepEditing=false;
      this._review=false; this._conversionConfirmed=false; this._message=result.schedule_content_refreshed===false?result.message:"Saved to Resideo and read back successfully. Refresh the schedule in the official app to confirm."; this._messageType=result.schedule_content_refreshed===false?"warning":"success";
      if(this._config?.dialog && result.verification_status==="verified")this.dispatchEvent(new CustomEvent("resideo-mode-saved",{bubbles:true,composed:true,detail:{mode:result.schedule_type}}));
    } catch(err) {if(nonce===this._nonce) {this._review=false;this._enabledReview=null;
      const reason=String(err.message || err);
      this._message=reason.toLowerCase().includes("no write was sent")
        ? `${reason}\nYour draft is retained. Correct the indicated input or reload the cloud data.`
        : `${reason}\nYour draft is retained. If delivery or readback is uncertain, check the app and reload before retrying.`;
      this._messageType="error";}}
    finally {if(nonce===this._nonce) {this._busy=false; this.render();}}
  }
  _exportBackup() {
    const data={format:"resideo-native-schedule-v1",schedule_kind:this.hot ? "hot_water" : "heating",temperature_unit:this._baseline.temperature_unit, schedule_type:this._baseline.schedule_type,days:clone(this._baseline.days),exported_at:new Date().toISOString()};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    const a=document.createElement("a"); a.href=url; a.download=`resideo-${data.schedule_kind}-schedule.json`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async _importFile(file) {
    if(!file) return;
    const entity = this._selected, baseline = this._baseline;
    try {
      if(this._targetMode==="Geofence")throw new Error("Choose a Timed draft before importing a timed backup.");
      if(file.size>100000) throw new Error("Backup is too large (maximum 100 KB).");
      const data=JSON.parse(await file.text());
      if (entity !== this._selected || baseline !== this._baseline) return;
      if(data.format!=="resideo-native-schedule-v1" || data.schedule_kind!==(this.hot ? "hot_water" : "heating")) throw new Error("Choose an editor backup for this type of device.");
      if(!this.hot && data.temperature_unit!==this._baseline.temperature_unit) throw new Error("Backup temperature unit differs from this thermostat.");
      const problem=validateDraft(data.days,this.hot,this._baseline.temperature_limits || [],6,true,!this.hot || !this.fullWeek,this._baseline.time_step_minutes || (this.hot ? 10 : null)); if(problem) throw new Error(problem);
      this._draft=normalizedDays(data.days); this._newDraft=this.fullWeek; this._message="Backup imported into draft only. Review before saving to this device."; this._messageType="";
      if(!this.hot && this.fullWeek && this._baseline.schedule_type!=="Timed")this._targetMode="Timed";
    } catch(err) {this._message=err.message || String(err); this._messageType="error";}
    this.render();
  }
  _settingsEntry() {
    if(this._entryFilter)return this._entryFilter;
    if(this._entryByEntity.get(this._selected))return this._entryByEntity.get(this._selected);
    const ids=[...new Set([...this._entryByEntity.values()].filter(Boolean))];return ids.length===1?ids[0]:null;
  }
  async _getOptions(entry) {
    const flow=await this._hass.callApi("POST","config/config_entries/options/flow",{handler:entry});
    const fields=Object.fromEntries((flow.data_schema || []).map(f=>[f.name,f]));
    const names=["poll_interval","default_hold","show_schedule_sidebar"];
    if(flow.type!=="form" || !flow.flow_id || Object.keys(fields).some(k=>!names.includes(k)) || names.some(k=>!Object.hasOwn(fields,k))){
      if(flow.flow_id)await this._hass.callApi("DELETE",`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});
      throw new Error("Integration settings differ from this editor. Reload after updating the complete integration folder.");
    }
    return {flow,values:Object.fromEntries(names.map(k=>[k,fields[k].default]))};
  }
  async _loadSidebar() {
    if(this._config?.dialog)return;
    const entry=this._settingsEntry();
    if(!entry || !this._hass?.callApi || this._sidebarLoading || this._optionsForm)return;
    this._sidebarLoading=entry;this.render();let flow;
    try{
      const options=await this._getOptions(entry);flow=options.flow;
      this._sidebarByEntry.set(entry,options.values.show_schedule_sidebar===true);
    }catch(err){this._message=`Could not read the sidebar setting: ${err.message || err}`;this._messageType="error";}
    finally{
      if(flow)await this._hass.callApi("DELETE",`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});
      this._sidebarLoading=null;this.render();
      if(this.isConnected && this._settingsEntry() && this._settingsEntry()!==entry)void this._loadSidebar();
    }
  }
  async _toggleSidebar() {
    const entry=this._settingsEntry();
    if(!entry || this._busy || this._sidebarLoading || this._optionsForm || this.dirty || this._uncertain)return;
    this._busy=true;this.render();let flow;
    try{
      const options=await this._getOptions(entry);flow=options.flow;
      const enabled=!options.values.show_schedule_sidebar;
      const result=await this._hass.callApi("POST",`config/config_entries/options/flow/${flow.flow_id}`,{...options.values,show_schedule_sidebar:enabled});
      if(result.type!=="create_entry")throw new Error("Home Assistant did not accept the sidebar setting.");
      flow=null;this._sidebarByEntry.set(entry,enabled);
      this._message=enabled?"Scheduler added to the sidebar.":"Sidebar shortcut disabled for this account. It remains visible if another account has it enabled.";this._messageType="success";
    }catch(err){this._message=`Could not change the sidebar setting: ${err.message || err}`;this._messageType="error";}
    finally{
      if(flow)await this._hass.callApi("DELETE",`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});
      this._busy=false;this.render();
    }
  }
  async _openOptions() {
    if(this._busy || this._sidebarLoading)return;
    if(this.dirty){this._message="Save or discard the draft before changing integration settings.";this._messageType="error";this.render();return;}
    const entry=this._settingsEntry();
    if(!entry || !this._hass.callApi){this._message="Choose a thermostat from the account whose settings you want to edit.";this._messageType="error";this.render();return;}
    this._busy=true;this.render();let flow;
    try{
      const options=await this._getOptions(entry);flow=options.flow;
      this._optionsValues=options.values;this._optionsForm=flow;
      this._sidebarByEntry.set(entry,options.values.show_schedule_sidebar===true);
    }catch(err){if(flow?.flow_id)await this._hass.callApi("DELETE",`config/config_entries/options/flow/${flow.flow_id}`).catch(()=>{});this._message=err.message || String(err);this._messageType="error";}
    finally{this._busy=false;this.render();}
  }
  _optionsHTML() {
    const v=this._optionsValues,disabled=this._busy?"disabled":"";
    return `<section class="panel"><h2>Integration settings</h2><div class="toolbar"><label class="field"><span>Refresh interval (seconds)</span><input type="number" min="30" max="600" step="1" data-option="poll_interval" aria-label="Refresh interval" value="${esc(v.poll_interval)}" ${disabled}></label><label class="field"><span>Default hold for temperature changes</span><select data-option="default_hold" aria-label="Default hold" ${disabled}><option value="TemporaryHold" ${v.default_hold==="TemporaryHold"?"selected":""}>Until the next period</option><option value="PermanentHold" ${v.default_hold==="PermanentHold"?"selected":""}>Permanent hold</option></select></label></div><label class="confirm"><input type="checkbox" data-option="show_schedule_sidebar" ${v.show_schedule_sidebar?"checked":""} ${disabled}><span>Show Resideo schedules in the sidebar</span></label><div class="actions"><button data-action="settings-cancel" ${disabled}>Cancel settings</button><button class="primary" data-action="settings-save" ${disabled}>Save integration settings</button></div></section>`;
  }
  async _cancelOptions() {
    if(!this._optionsForm || this._busy)return;
    const flow=this._optionsForm;this._optionsForm=null;this._busy=true;this.render();
    try{await this._hass.callApi("DELETE",`config/config_entries/options/flow/${flow.flow_id}`);}
    catch(err){this._message=err.message || String(err);this._messageType="error";}
    finally{this._busy=false;this.render();}
  }
  async _saveOptions() {
    if(!this._optionsForm || this._busy)return;
    const values=this._optionsValues;
    if(!Number.isInteger(values.poll_interval) || values.poll_interval<30 || values.poll_interval>600 || !["TemporaryHold","PermanentHold"].includes(values.default_hold) || typeof values.show_schedule_sidebar!=="boolean"){this._message="Choose a refresh interval from 30 to 600 seconds and valid hold/sidebar settings.";this._messageType="error";this.render();return;}
    const flow=this._optionsForm;this._optionsForm=null;this._busy=true;this.render();
    try{const result=await this._hass.callApi("POST",`config/config_entries/options/flow/${flow.flow_id}`,clone(values));
      if(result.type!=="create_entry"){this._optionsForm=result;throw new Error("Home Assistant did not accept these integration settings.");}
      this._sidebarByEntry.set(this._settingsEntry(),values.show_schedule_sidebar);
      this._message="Integration settings saved. Sidebar-only changes apply immediately; other changes reload the account.";this._messageType="success";
    }catch(err){if(!this._optionsForm)this._optionsForm=flow;this._message=err.message || String(err);this._messageType="error";}
    finally{this._busy=false;this.render();}
  }
}
if(globalThis.customElements) {
  // A previously imported module may already own the legacy element name.
  // HA's sidebar uses this version's name so that old class cannot win.
  if(!customElements.get(PANEL_ELEMENT)) customElements.define(PANEL_ELEMENT,class extends ResideoScheduleEditor {});
  if(!customElements.get("resideo-schedule-panel")) customElements.define("resideo-schedule-panel",class extends ResideoScheduleEditor {});
  if(!customElements.get("resideo-schedule-card")) customElements.define("resideo-schedule-card",class extends ResideoScheduleEditor {});
  globalThis.customCards=globalThis.customCards || [];
  if(!globalThis.customCards.some(c=>c.type==="resideo-schedule-card")) globalThis.customCards.push({type:"resideo-schedule-card",name:"Resideo schedule editor",description:"Read, edit and create Resideo timed schedules."});
}
