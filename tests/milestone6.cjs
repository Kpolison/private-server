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
  const channel=await store.createChannel(vault,manga,'Interactions');
  const original=store.CHANNEL_TEMPLATE+'\n'+legacy('Same')+legacy('Same')+legacy('![[Attachments/existing.png]]');
  data.set(channel,original);
  const parse=()=>store.parseChannel(data.get(channel));
  assert.equal(parse().messages.length,3);assert(!parse().messages[0].id);
  plugin=new (load(fs.readFileSync('main.js','utf8')).default)();plugin.onload();await plugin.ribbon();await tick();
  const view=leaves[0].view;
  assert.equal(data.get(channel),original,'viewing does not migrate');
  assert(find(view.feed,e=>e.text==='Same'));
  const second=parse().messages[1];const secondId=await store.mutateMessage(vault,channel,second,'identify');
  assert(!parse().messages[0].id);assert.equal(parse().messages[1].id,secondId);assert(!parse().messages[2].id);
  assert(data.get(channel).startsWith(original.slice(0,second.source.start)));
  assert(data.get(channel).endsWith(original.slice(second.source.end)));
  assert.equal(parse().messages[1].body,'Same');
  await assert.rejects(()=>store.mutateMessage(vault,channel,second,'delete'),/changed/,'stale legacy snapshot rejected');
  const first=parse().messages[0];await store.mutateMessage(vault,channel,first,'edit','First edited\nMultiline');
  assert(parse().messages[0].id);assert.equal(parse().messages[0].timestamp,timestamp);
  const reference=parse().messages[1];
  await store.sendMessage(vault,channel,'Reply body',secondId);
  let reply=parse().messages.at(-1);assert(reply.id);assert.equal(reply.replyToId,secondId);assert.equal(reply.body,'Reply body');
  const replyId=reply.id,replyTimestamp=reply.timestamp;
  await store.mutateMessage(vault,channel,reply,'edit','Reply edited');reply=parse().messages.at(-1);
  assert.equal(reply.id,replyId);assert.equal(reply.replyToId,secondId);assert.equal(reply.timestamp,replyTimestamp);
  // Stable IDs locate moved blocks, but reject concurrent edits of that block.
  await store.mutateMessage(vault,channel,parse().messages[0],'delete');
  await store.mutateMessage(vault,channel,reference,'edit','Target updated');
  await assert.rejects(()=>store.mutateMessage(vault,channel,reference,'delete'),/changed/);
  await view.loadFeed(false);assert(find(view.feed,e=>e.text==='↪ Kyle · Target updated'));
  const ref=find(view.feed,e=>e.attrs['aria-label']==='Jump to original: Target updated');ref.onclick();
  assert(view.feed.lastScroll);assert(view.messageElements.get(secondId).classes.has('private-server-message-highlight'));
  fireTimers();assert(!view.messageElements.get(secondId).classes.has('private-server-message-highlight'));
  const image={id:'pending',name:'Test.png',extension:'png',blob:new Blob(['fixture'])};
  await attachments.sendWithImages(vault,channel,'Caption',[image],secondId);
  await attachments.sendWithImages(vault,channel,'',[image],secondId);
  assert.equal(parse().messages.at(-1).replyToId,secondId);assert.equal(parse().messages.at(-1).parts[0].type,'image');
  let imageMessage=parse().messages.at(-2);const imagePaths=imageMessage.parts.filter(p=>p.type==='image').map(p=>p.path).join();
  const imageId=imageMessage.id,imageTime=imageMessage.timestamp;
  await store.mutateMessage(vault,channel,imageMessage,'edit','');imageMessage=parse().messages.at(-2);
  assert.equal(imageMessage.id,imageId);assert.equal(imageMessage.timestamp,imageTime);assert.equal(imageMessage.replyToId,secondId);
  assert.equal(imageMessage.parts.filter(p=>p.type==='image').map(p=>p.path).join(),imagePaths);
  await assert.rejects(()=>store.mutateMessage(vault,channel,parse().messages[0],'edit','  '),/cannot be empty/);
  await view.loadFeed(false);await view.reply(channel,parse().messages[0]);
  view.input.value='Draft reply';view.input.oninput();view.session.pendingImages.set(channel.path,[image]);view.renderPreviews();
  fail=true;await view.send();fail=false;
  assert.equal(view.session.replies.get(channel.path),secondId);assert.equal(view.input.value,'Draft reply');assert.equal(view.pendingImages()[0],image);
  const otherChannel=await store.createChannel(vault,other,'Elsewhere');await tick();
  view.session.selectedPath=otherChannel.path;view.refresh();await tick();assert(view.replyBanner.hidden);
  view.session.selectedPath=channel.path;view.refresh();await tick();assert(!view.replyBanner.hidden);assert.equal(view.input.value,'Draft reply');
  find(view.replyBanner,e=>e.attrs['aria-label']==='Cancel reply').onclick();
  assert.equal(view.input.value,'Draft reply');assert.equal(view.pendingImages()[0],image);assert(!view.session.replies.has(channel.path));
  await view.reply(channel,parse().messages[0]);
  await view.send();assert(!view.session.replies.has(channel.path));assert.equal(parse().messages.at(-1).replyToId,secondId);
  // Desktop context menu and edit dialog preserve input on failure.
  await view.loadFeed(false);let article=view.feed.children[0];let prevented=false;
  article.oncontextmenu({preventDefault(){prevented=true;}});assert(prevented);
  find(modal.contentEl,e=>e.text==='Edit').onclick();
  const editInput=find(modal.contentEl,e=>e.tag==='textarea');editInput.value='Dialog edit';
  fail=true;await find(modal.contentEl,e=>e.text==='Save').onclick();fail=false;assert.equal(editInput.value,'Dialog edit');
  await find(modal.contentEl,e=>e.text==='Save').onclick();await tick();assert.equal(parse().messages[0].body,'Dialog edit');
  article=view.feed.children[0];article.oncontextmenu({preventDefault(){}});find(modal.contentEl,e=>e.text==='Delete').onclick();
  const beforeDelete=data.get(channel);assert.equal(data.get(channel),beforeDelete);find(modal.contentEl,e=>e.text==='Cancel').onclick();assert.equal(data.get(channel),beforeDelete);
  article.oncontextmenu({preventDefault(){}});find(modal.contentEl,e=>e.text==='Delete').onclick();
  const deletedBlock=parse().messages[0].source;const count=parse().messages.length,deletesBefore=deletes;await find(modal.contentEl,e=>e.text==='Delete').onclick();await tick();
  assert.equal(data.get(channel),beforeDelete.slice(0,deletedBlock.start)+beforeDelete.slice(deletedBlock.end),'only target source range removed');assert.equal(parse().messages.length,count-1);assert(!parse().messages.some(m=>m.id===secondId));assert(parse().messages.some(m=>m.replyToId===secondId));assert.equal(deletes,deletesBefore);
  assert(find(view.feed,e=>e.text==='Original message deleted or unavailable'&&e.disabled));
  await assert.rejects(()=>store.sendMessage(vault,otherChannel,'Cross-channel',replyId),/unavailable/);
  const legacyImage=parse().messages.find(m=>!m.id);
  assert(legacyImage);await store.mutateMessage(vault,channel,legacyImage,'edit','Legacy image caption');
  const editedImage=parse().messages.find(m=>m.body.includes('Legacy image caption'));
  assert(editedImage.id);assert.equal(editedImage.parts.find(p=>p.type==='image').path,'Attachments/existing.png');
  const good=store.appendMessage(store.CHANNEL_TEMPLATE,'Text');const goodId=store.parseChannel(good).messages[0].id;
  for(const bad of [good.replace(`<!-- private-server-id: ${goodId} -->`,'<!-- private-server-id: invalid -->'),good.replace(`<!-- private-server-id: ${goodId} -->`,`<!-- private-server-id: ${goodId} -->\n<!-- private-server-id: ${goodId} -->`),good+good.slice(good.indexOf('## '))]) assert.equal(store.parseChannel(bad).writable,false);
  const missingId='00000000-0000-4000-8000-000000000000';
  const missing=good.replace(`<!-- private-server-id: ${goodId} -->`,`<!-- private-server-id: ${goodId} -->\n<!-- private-server-reply-to: ${missingId} -->`);
  assert(!store.parseChannel(missing.replace(`<!-- private-server-reply-to: ${missingId} -->`,`<!-- private-server-reply-to: ${missingId} -->\n<!-- private-server-reply-to: ${missingId} -->`)).writable);
  assert(store.parseChannel(missing).writable);assert(!store.parseChannel(missing).messages[0].body.includes('private-server'));
  data.set(channel,missing.replace(missingId,goodId));await view.loadFeed(false);assert(find(view.feed,e=>e.disabled&&e.text.includes('unavailable')));
  const crlf=(store.CHANNEL_TEMPLATE+'\n'+legacy('CRLF')).replace(/\n/g,'\r\n');data.set(channel,crlf);
  await store.mutateMessage(vault,channel,parse().messages[0],'identify');assert(parse().writable);assert(!/(?<!\r)\n/.test(data.get(channel)));
  // Long-press recognizer with controlled timers: movement, cancellation, taps, and cleanup.
  const fallbackCode=esbuild.buildSync({entryPoints:['messages.ts'],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],write:false}).outputFiles[0].text;
  const box={module:{exports:{}},crypto:{getRandomValues:webcrypto.getRandomValues.bind(webcrypto)},require:()=>api};
  vm.runInNewContext(fallbackCode,box);assert.match(box.module.exports.messageId(),/^[a-f0-9]{32}$/);
  const el=new Element();let opened=0;const cleanup=actionModule.bindMessageActions(el,true,()=>opened++);
  const down={isPrimary:true,pointerType:'touch',pointerId:1,clientX:0,clientY:0};
  el.onpointerdown(down);el.onpointermove({...down,clientY:20});fireTimers();assert.equal(opened,0);
  el.onpointerdown(down);el.onpointercancel();fireTimers();assert.equal(opened,0);
  el.onpointerdown(down);el.onpointerup();fireTimers();assert.equal(opened,0);
  el.onpointerdown(down);fireTimers();assert.equal(opened,1);
  el.oncontextmenu({preventDefault(){}});assert.equal(opened,1,'native long-press context event does not duplicate modal');
  let clickBlocked=false;el.dispatch('click',{preventDefault(){clickBlocked=true;},stopPropagation(){}});assert(clickBlocked);
  el.onpointerdown(down);cleanup();fireTimers();assert.equal(opened,1);
  await view.onClose();assert.equal(timers.size,0);
  console.log('PASS: M6 legacy/read-only parsing, IDs/replies, exact lazy assignment, source conflicts, edit/delete safety, image replies and preservation, reply drafts/failures/channel isolation, reference refresh/jump/fallback, action dialogs, long-press cancellation and cleanup. No real-device/layout claims.');
})().catch(error=>{console.error(error);process.exitCode=1;});
