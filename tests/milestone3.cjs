const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
class Element {
  constructor(opts = {}, doc = { activeElement: null }) { this.children=[]; this.attrs=opts.attr||{}; this.text=opts.text||''; this.ownerDocument=doc; this.scrollTop=0; this.scrollHeight=100; this.clientHeight=80; this.value=''; }
  createEl(tag, opts={}) { const el=new Element(opts,this.ownerDocument); el.tag=tag; this.children.push(el); return el; }
  createDiv(opts) { return this.createEl('div',opts); } createSpan(opts) { return this.createEl('span',opts); }
  empty() { this.children=[]; } addClass() {} removeClass() {} setText(text) { this.text=text; }
  setAttribute(k,v) { this.attrs[k]=v; } getAttribute(k) { return this.attrs[k]; }
  contains(el) { return this===el || this.children.some(x=>x.contains(el)); } focus() { this.ownerDocument.activeElement=this; }
}
class Component { constructor(){this.events=[];} registerEvent(off){this.events.push(off);} addChild(x){return x;} removeChild(x){x.events.forEach(off=>off());} }
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
function load(source){const box={module:{exports:{}},queueMicrotask,require:id=>{assert.equal(id,'obsidian');return api;}};vm.runInNewContext(source,box);return box.module.exports;}
function moduleAt(path){return load(esbuild.buildSync({entryPoints:[path],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],write:false}).outputFiles[0].text);}
const store=moduleAt('messages.ts'), hierarchy=moduleAt('channels.ts');
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const find=(el,test)=>test(el)?el:el.children.map(x=>find(x,test)).find(Boolean);
(async()=>{
  assert.equal(hierarchy.discoverCategories(vault)[0].groups.length,3);
  assert.equal(hierarchy.discoverCategories(vault)[0].groups[0].channels.length,0);
  for(const name of ['../oops','a/b','a\\b','..','CON','x:bad','[wiki]']) assert.throws(()=>store.channelFilename(name));
  plugin=new (load(fs.readFileSync('main.js','utf8')).default)();plugin.onload();
  await Promise.all([plugin.ribbon(),plugin.command.callback(),plugin.ribbon()]);await tick();assert.equal(leaves.length,1);
  const view=leaves[0].view;assert.equal(view.heading.text,'No channel selected');assert.equal(view.composer.hidden,true);
  find(view.sidebar,el=>el.attrs['aria-label']==='Create channel in Manga').onclick();
  const input=find(modal.contentEl,el=>el.tag==='input');input.value='Hunter x Hunter';
  const form=find(modal.contentEl,el=>el.tag==='form');await form.onsubmit({preventDefault(){}});await tick();
  const file=files.get('Channels/Media/Manga/Hunter x Hunter.md');assert(file instanceof TFile);assert.equal(view.selectedFile,file);assert.equal(view.composer.hidden,false);
  await assert.rejects(()=>store.createChannel(vault,manga,'hunter x hunter'),/already exists/);
  const setDraft=text=>{view.input.value=text;view.input.oninput();};
  setDraft('First thought');view.input.onkeydown({key:'Enter',shiftKey:false,isComposing:false,preventDefault(){}});await tick();
  assert.equal(store.parseChannel(data.get(file)).messages[0].body,'First thought');assert.equal(view.input.value,'');
  setDraft('Line one');let prevented=false;view.input.onkeydown({key:'Enter',shiftKey:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
  setDraft('Line one\n## 2026-09-14T00:00:00.000Z\n---\n> quoted\n![[future.png]]');view.composer.onsubmit({preventDefault(){}});await tick();
  const parsed=store.parseChannel(data.get(file));assert.equal(parsed.messages.length,2);assert.equal(parsed.messages[1].body,'Line one\n## 2026-09-14T00:00:00.000Z\n---\n> quoted\n![[future.png]]');
  const saved=data.get(file);setDraft('   ');await view.send();assert.equal(data.get(file),saved);
  setDraft('keep this draft');fail=true;await view.send();fail=false;assert.equal(view.input.value,'keep this draft');assert(notices.some(x=>x.includes('draft is preserved')));
  const second=await store.createChannel(vault,other,'Hunter x Hunter');await tick();
  view.session.selectedPath=second.path;view.refresh();await tick();assert.equal(view.input.value,'');
  view.session.selectedPath=file.path;view.refresh();await tick();assert.equal(view.input.value,'keep this draft');assert(find(view.feed,el=>el.text==='First thought'));
  const original='---\ntitle: Ordinary\n---\nDo not change me';const note=await vault.create('Channels/Media/Manga/Ordinary.md',original);await tick();
  view.session.selectedPath=note.path;view.refresh();await tick();assert.equal(view.input.disabled,true);await assert.rejects(()=>store.sendMessage(vault,note,'no'),/Read-only/);assert.equal(data.get(note),original);
  const malformed=store.CHANNEL_TEMPLATE+'\nUnrelated prose\n';assert.equal(store.parseChannel(malformed).writable,false);assert.throws(()=>store.appendMessage(malformed,'no'));
  const crlf=store.CHANNEL_TEMPLATE.replace(/\n/g,'\r\n');assert(store.appendMessage(crlf,'hello').startsWith(crlf));assert.equal(store.parseChannel(store.appendMessage(crlf,'hello')).messages[0].body,'hello');
  view.session.selectedPath=file.path;view.refresh();await tick();await store.sendMessage(vault,file,'External message');await tick();assert(find(view.feed,el=>el.text==='External message'));
  const oldPath=file.path;files.delete(oldPath);file.path='Channels/Media/Manga/Renamed.md';file.name='Renamed.md';file.basename='Renamed';files.set(file.path,file);emit('rename',file,oldPath);await tick();assert.equal(view.session.selectedPath,file.path);
  await view.onClose();await view.onOpen();await tick();assert(find(view.feed,el=>el.text==='First thought'));
  files.delete(file.path);manga.children=manga.children.filter(x=>x!==file);emit('delete',file);await tick();assert.notEqual(view.session.selectedPath,file.path);
  await view.onClose();for(const set of listeners.values())assert.equal(set.size,0);
  assert.equal(music.children.length,0);assert(files.has(music.path));
  console.log('PASS: modal creation/exact path, empty groups, deduplication, Enter, Shift+Enter, Send, multiline/delimiter round-trip, empty rejection, failed-send draft, switching/reopening, unmarked safety, malformed safety, CRLF, external modify, rename/delete, and event cleanup.');
})().catch(error=>{console.error(error);process.exitCode=1;});
