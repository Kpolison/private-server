const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { webcrypto } = require('node:crypto');
// Lightweight DOM behavior only: no assertions here claim real layout/keyboard geometry.
class EventTargetMock {
  constructor(){ this.listeners=new Map(); }
  addEventListener(type, fn){const set=this.listeners.get(type)||new Set();set.add(fn);this.listeners.set(type,set);}
  removeEventListener(type, fn){this.listeners.get(type)?.delete(fn);}
  dispatch(type, event={}){for(const fn of this.listeners.get(type)||[])fn(event);}
}
const timers=new Map();let timerId=0;
const setTimer=fn=>{timers.set(++timerId,fn);return timerId;};
const clearTimer=id=>timers.delete(id);
const fireTimers=()=>{for(const [id,fn] of [...timers]){timers.delete(id);fn();}};
const win=new EventTargetMock();
win.innerHeight=700;win.innerWidth=390;
win.visualViewport=Object.assign(new EventTargetMock(),{offsetTop:0,height:700});
let frameSequence=0;
const frames=new Map();
win.requestAnimationFrame=fn=>{const id=++frameSequence;frames.set(id,fn);return id;};
win.cancelAnimationFrame=id=>frames.delete(id);
class Element extends EventTargetMock {
  constructor(opts = {}, doc = { activeElement: null, defaultView:win }) {
    super();this.children=[];this.attrs=opts.attr||{};this.text=opts.text||'';this.ownerDocument=doc;
    this.scrollTop=0;this.scrollHeight=100;this.clientHeight=80;this.value='';this.inert=false;this.isConnected=true;
    this.classes=new Set((typeof opts==='string'?opts:opts.cls||'').split(' '));
    this.classList={toggle:(cls,on)=>{if(on)this.classes.add(cls);else this.classes.delete(cls);}};
    const styles=new Map();this.style={setProperty:(k,v)=>styles.set(k,v),getPropertyValue:k=>styles.get(k)||'',removeProperty:k=>styles.delete(k)};
  }
  appendChild(el){if(el.parentElement)el.parentElement.children=el.parentElement.children.filter(x=>x!==el);this.children.push(el);el.parentElement=this;return el;}
  insertBefore(el,before){this.appendChild(el);this.children=this.children.filter(x=>x!==el);this.children.splice(this.children.indexOf(before),0,el);return el;}
  createEl(tag,opts={}){const el=new Element(opts,this.ownerDocument);el.tag=tag;return this.appendChild(el);}
  createDiv(opts){return this.createEl('div',opts);}createSpan(opts){return this.createEl('span',opts);}
  empty(){this.children=[];}addClass(...classes){classes.forEach(x=>this.classes.add(x));}removeClass(...classes){classes.forEach(x=>this.classes.delete(x));}setText(text){this.text=text;}
  setAttribute(k,v){this.attrs[k]=v;}getAttribute(k){return this.attrs[k];}removeAttribute(k){delete this.attrs[k];}
  contains(el){return this===el||this.children.some(x=>x.contains(el));}focus(){this.ownerDocument.activeElement=this;}
  scrollTo(options){this.lastScroll=options;this.scrollTop=options.top;}
  getClientRects(){return [{}];}getBoundingClientRect(){return {top:0};}
  querySelectorAll(){const all=[];const visit=el=>{if(el.tag==='button'&&!el.disabled)all.push(el);el.children.forEach(visit);};this.children.forEach(visit);return all;}
}
class Component {
  constructor(){this.events=[];this.components=[];}
  register(fn){this.events.push(fn);}registerEvent(off){this.events.push(off);}
  registerDomEvent(target,type,fn){target.addEventListener(type,fn);this.register(()=>target.removeEventListener(type,fn));}
  addChild(x){this.components.push(x);x.onload?.();return x;}
  removeChild(x){x.unload();this.components=this.components.filter(c=>c!==x);}
  unload(){this.components.forEach(c=>c.unload());this.events.forEach(off=>off());this.events=[];this.onunload?.();}
}
class TFolder { constructor(path,children=[]){this.path=path;this.name=path.split('/').pop();this.children=children;} }
class TFile { constructor(path,parent){this.path=path;this.name=path.split('/').pop();this.extension=this.name.split('.').pop();this.basename=this.name.slice(0,-this.extension.length-1);this.parent=parent;} }
const notices=[]; let modal;
class Modal { constructor(app){this.app=app;this.containerEl=new Element();this.modalEl=this.containerEl.createDiv();this.contentEl=this.modalEl.createDiv();modal=this;} open(){this.onOpen();} close(){this.onClose();} }
const parseYaml = text => Object.fromEntries(text.split('\n').filter(Boolean).map(line=>{const [key,...parts]=line.split(':');const v=parts.join(':').trim();return [key,v==='true'?true:v==='1'?1:v];}));
const listeners=new Map(), data=new Map(), files=new Map();
const root=new TFolder('Channels'); files.set(root.path,root);
function folder(path,parent){const f=new TFolder(path);parent.children.push(f);files.set(path,f);return f;}
const media=folder('Channels/Media',root), manga=folder('Channels/Media/Manga',media), music=folder('Channels/Media/Music',media);
const other=folder('Channels/Media/Other',media);
const emit=(type,...args)=>{for(const fn of listeners.get(type)||[]) fn(...args);};
let fail=false;
const vault={ getAbstractFileByPath:path=>files.get(path)||null,
  on(type,fn){const s=listeners.get(type)||new Set();s.add(fn);listeners.set(type,s);return()=>s.delete(fn);},
  async create(path,content){if(files.has(path))throw Error('Already exists');const parent=files.get(path.slice(0,path.lastIndexOf('/')));const file=new TFile(path,parent);files.set(path,file);parent.children.push(file);data.set(file,content);emit('create',file);return file;},
  async read(file){if(!data.has(file))throw Error('Missing');return data.get(file);},
  async process(file,fn){if(fail)throw Error('Disk unavailable');const next=fn(data.get(file));data.set(file,next);emit('modify',file);return next;}
};
let plugin;const leaves=[];
const workspace={getLeavesOfType:()=>leaves,getLeaf(){const leaf={async setViewState(){leaf.view=plugin.factory(leaf);await leaf.view.onOpen();leaves.push(leaf);}};return leaf;},async revealLeaf(leaf){this.active=leaf;},onLayoutReady(fn){fn();}};
const app={vault,workspace};
class ItemView extends Component {constructor(leaf){super();this.app=app;this.contentEl=new Element();}}
class Plugin extends Component {constructor(){super();this.app=app;} registerView(t,f){this.factory=f;} addRibbonIcon(i,l,cb){this.ribbon=cb;} addCommand(c){this.command=c;}}
const api={TFile,TFolder,Component,Modal,ItemView,Plugin,Platform:{isMobile:false},Notice:class{constructor(text){notices.push(text);}},parseYaml};
function load(source){const box={module:{exports:{}},queueMicrotask,Error,setTimeout:setTimer,clearTimeout:clearTimer,crypto:webcrypto,URL,Blob,require:id=>{assert.equal(id,'obsidian');return api;}};vm.runInNewContext(source,box);return box.module.exports;}
function moduleAt(path){return load(esbuild.buildSync({entryPoints:[path],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],write:false}).outputFiles[0].text);}
const store=moduleAt('messages.ts'), attachments=moduleAt('attachments.ts');
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const find=(el,test)=>test(el)?el:el.children.map(x=>find(x,test)).find(Boolean);

let deletes=0;
vault.createFolder=async path=>folder(path,root);
vault.createBinary=async(path,bytes)=>vault.create(path,bytes);
vault.readBinary=async file=>data.get(file);
vault.delete=async file=>{deletes++;files.delete(file.path);data.delete(file);};
vault.getResourcePath=file=>`fixture:${file.path}`;
const actionModule=moduleAt('MessageActions.ts');
const timestamp='2026-09-15T04:00:00.000Z';
const legacy=body=>`## ${timestamp}\n\n> ${body}\n\n`;

(async()=>{
  const message=store.parseChannel(store.appendMessage(store.CHANNEL_TEMPLATE,'Existing\nmultiline')).messages[0];
  const count=()=>[win,win.visualViewport].filter(Boolean).reduce((sum,x)=>sum+[...x.listeners.values()].reduce((n,v)=>n+v.size,0),0);
  let saved='';
  const desktop=new actionModule.EditMessage(app,message,async text=>{saved=text;});desktop.open();
  assert.equal(find(desktop.contentEl,e=>e.tag==='textarea').value,'Existing\nmultiline');
  assert(!desktop.containerEl.classes.has('private-server-edit-viewport'));assert.equal(count(),0);
  assert(!find(desktop.contentEl,e=>e.classes.has('private-server-edit-footer')));
  find(desktop.contentEl,e=>e.tag==='textarea').value='Desktop save';
  await find(desktop.contentEl,e=>e.text==='Save').onclick();assert.equal(saved,'Desktop save');
  api.Platform.isMobile=true;
  for(let iteration=0;iteration<3;iteration++){
    const edit=new actionModule.EditMessage(app,message,async text=>{saved=text;});edit.open();
    assert.equal(count(),3);assert(edit.containerEl.classes.has('private-server-edit-viewport'));
    const input=find(edit.contentEl,e=>e.tag==='textarea');assert.equal(input.value,'Existing\nmultiline');
    const footer=find(edit.contentEl,e=>e.classes.has('private-server-edit-footer'));
    assert(footer);assert(find(footer,e=>e.text==='Cancel'));assert(find(footer,e=>e.text==='Save'));
    const height=()=>edit.containerEl.style.getPropertyValue('--private-server-edit-height');
    assert.equal(height(),'700px');
    win.visualViewport.height=320;win.visualViewport.dispatch('resize');assert.equal(height(),'320px');
    win.visualViewport.offsetTop=24;win.visualViewport.dispatch('scroll');
    assert.equal(edit.containerEl.style.getPropertyValue('--private-server-edit-top'),'24px');
    input.value='Keyboard edit\nsecond line';
    if(iteration===0){await find(footer,e=>e.text==='Save').onclick();assert.equal(saved,'Keyboard edit\nsecond line');}
    else find(footer,e=>e.text==='Cancel').onclick();
    assert.equal(count(),0);assert.equal(height(),'');assert(!edit.modalEl.classes.has('private-server-edit-mobile-modal'));
    win.visualViewport.height=700;win.visualViewport.offsetTop=0;
  }
  const failed=new actionModule.EditMessage(app,message,async()=>{throw Error('Conflict');});failed.open();
  const input=find(failed.contentEl,e=>e.tag==='textarea');input.value='Preserve edit';
  await find(failed.contentEl,e=>e.text==='Save').onclick();assert.equal(input.value,'Preserve edit');assert(!input.disabled);assert.equal(count(),3);
  failed.close();assert.equal(count(),0);
  const viewport=win.visualViewport;win.visualViewport=null;
  const fallback=new actionModule.EditMessage(app,message,async()=>{});fallback.open();
  assert.equal(fallback.containerEl.style.getPropertyValue('--private-server-edit-height'),'700px');
  win.innerHeight=360;win.dispatch('resize');assert.equal(fallback.containerEl.style.getPropertyValue('--private-server-edit-height'),'360px');
  fallback.close();assert.equal(count(),0);win.visualViewport=viewport;
  console.log('PASS: Edit prefill/save/cancel/failure, mobile visible-height/offset updates, footer structure, repeated listener cleanup, window fallback, desktop unchanged. No visual/iOS keyboard claims.');
})().catch(error=>{console.error(error);process.exitCode=1;});
