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
const win=new EventTargetMock();
win.innerHeight=700;
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
class Modal { constructor(app){this.app=app;this.contentEl=new Element();modal=this;} open(){this.onOpen();} close(){this.onClose();} }
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
function load(source){const box={module:{exports:{}},queueMicrotask,Error,crypto:webcrypto,URL,Blob,require:id=>{assert.equal(id,'obsidian');return api;}};vm.runInNewContext(source,box);return box.module.exports;}
function moduleAt(path){return load(esbuild.buildSync({entryPoints:[path],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],write:false}).outputFiles[0].text);}
const store=moduleAt('messages.ts'), attachments=moduleAt('attachments.ts');
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const find=(el,test)=>test(el)?el:el.children.map(x=>find(x,test)).find(Boolean);
(async()=>{
  const first=await store.createChannel(vault,manga,'First');
  const second=await store.createChannel(vault,other,'Second');
  await store.sendMessage(vault,first,'Existing text');
  plugin=new (load(fs.readFileSync('main.js','utf8')).default)();plugin.onload();await plugin.ribbon();await tick();
  let view=leaves[0].view;
  assert.equal(view.mobileLayout,null,'desktop has no drawer component');
  assert.equal(view.input.attrs.rows,'3');assert.equal(view.imageButton.text,'Add images');
  assert(!view.contentEl.classes.has('private-server-mobile'));
  await view.onClose();leaves.length=0;
  api.Platform.isMobile=true;
  plugin=new (load(fs.readFileSync('main.js','utf8')).default)();plugin.onload();await plugin.ribbon();await tick();
  view=leaves[0].view;const mobile=view.mobileLayout;
  assert(mobile);assert(view.contentEl.classes.has('private-server-mobile'));
  assert.equal(view.sidebar.parentElement,mobile.drawer,'same hierarchy mounted inside drawer');
  assert.equal(view.input.attrs.rows,'1');assert.equal(view.imageButton.text,'+');assert.equal(view.sendButton.attrs['aria-label'],'Send message');
  assert(!find(view.contentEl,e=>e.text.includes('PNG · JPEG')));
  view.input.value='Draft survives navigation';view.input.oninput();
  const pending={id:'fixture',name:'Page.png',extension:'png',blob:new Blob(['fixture'])};
  view.session.pendingImages.set(first.path,[pending]);view.renderPreviews();
  const stored=data.get(first);
  assert.equal(mobile.menu.attrs['aria-expanded'],'false');assert(mobile.drawer.inert);
  mobile.menu.onclick();assert.equal(mobile.menu.attrs['aria-expanded'],'true');assert(!mobile.backdrop.hidden);assert(mobile.main.inert);
  assert.equal(view.contentEl.ownerDocument.activeElement,mobile.closeButton);
  assert.equal(mobile.main.attrs['aria-hidden'],'true');
  // Keyboard focus cycles within the drawer. Geometry is deliberately not tested.
  const buttons=mobile.drawer.querySelectorAll();buttons.at(-1).focus();let trapped=false;
  view.contentEl.dispatch('keydown',{key:'Tab',shiftKey:false,preventDefault(){trapped=true;}});
  assert(trapped);assert.equal(view.contentEl.ownerDocument.activeElement,buttons[0]);
  mobile.backdrop.onclick();assert(mobile.backdrop.hidden);assert(!mobile.main.inert);assert.equal(view.contentEl.ownerDocument.activeElement,mobile.menu);
  assert.equal(view.input.value,'Draft survives navigation');assert.equal(view.pendingImages()[0],pending);assert.equal(data.get(first),stored);
  mobile.menu.onclick();mobile.menu.onclick();assert.equal(mobile.menu.attrs['aria-expanded'],'false','menu toggles closed');
  mobile.menu.onclick();view.contentEl.dispatch('keydown',{key:'Escape',preventDefault(){},stopPropagation(){}});assert(mobile.drawer.inert);
  mobile.menu.onclick();mobile.closeButton.onclick();assert(mobile.drawer.inert);
  mobile.menu.onclick();find(view.sidebar,e=>e.attrs['data-key']===second.path).onclick();await tick();
  assert(mobile.drawer.inert);assert.equal(view.selectedFile,second);assert.equal(view.input.value,'');
  mobile.menu.onclick();find(view.sidebar,e=>e.attrs['data-key']===first.path).onclick();await tick();
  assert.equal(view.input.value,'Draft survives navigation');assert.equal(view.pendingImages()[0],pending);
  const remove=find(view.previews,e=>e.attrs['aria-label']==='Remove Page.png');assert.equal(remove.text,'×');assert.equal(remove.attrs.type,'button');remove.onclick();assert.equal(view.pendingImages().length,0);
  mobile.menu.onclick();find(view.sidebar,e=>e.attrs['aria-label']==='Create channel in Manga').onclick();
  find(modal.contentEl,e=>e.tag==='input').value='Created from drawer';await find(modal.contentEl,e=>e.tag==='form').onsubmit({preventDefault(){}});await tick();
  assert.equal(view.selectedFile.path,'Channels/Media/Manga/Created from drawer.md');assert(mobile.drawer.inert);
  view.input.value='Mobile text';view.input.oninput();await view.send();await tick();assert.equal(store.parseChannel(data.get(view.selectedFile)).messages[0].body,'Mobile text');
  assert.equal(view.input.value,'');
  await store.sendMessage(vault,view.selectedFile,'External update');await tick();assert(find(view.feed,e=>e.text==='External update'));
  const unmarked=await vault.create('Channels/Media/Manga/Unmarked.md','Unrelated note');await tick();view.session.selectedPath=unmarked.path;view.refresh();await tick();assert(view.input.disabled);
  const globalListenerCount=()=>[win,win.visualViewport].reduce((sum,target)=>sum+[...target.listeners.values()].reduce((n,s)=>n+s.size,0),0);
  assert(globalListenerCount()>0);
  await view.onClose();assert.equal(globalListenerCount(),0);assert.equal(frames.size,0);assert.equal(view.previewUrls.length,0);
  assert(!view.contentEl.classes.has('private-server-mobile'));
  for(const set of listeners.values())assert.equal(set.size,0);
  console.log('PASS: M5 mobile/desktop DOM branches, drawer menu/backdrop/Escape/close, focus loop/restoration, inert background, draft/pending retention, selection and creation dismissal, compact controls, removal, text/file refresh, read-only safety, and listener/frame cleanup. No visual geometry or iPhone keyboard claims.');
})().catch(error=>{console.error(error);process.exitCode=1;});
