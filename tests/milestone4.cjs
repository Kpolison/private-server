const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const esbuild = require('esbuild');
const { webcrypto } = require('node:crypto');
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
function load(source){const box={module:{exports:{}},queueMicrotask,Error,crypto:webcrypto,URL,Blob,require:id=>{assert.equal(id,'obsidian');return api;}};vm.runInNewContext(source,box);return box.module.exports;}
function moduleAt(path){return load(esbuild.buildSync({entryPoints:[path],bundle:true,platform:'browser',format:'cjs',external:['obsidian'],write:false}).outputFiles[0].text);}
const store=moduleAt('messages.ts'), attachments=moduleAt('attachments.ts');
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
const find=(el,test)=>test(el)?el:el.children.map(x=>find(x,test)).find(Boolean);
let binaryWrites = 0, failBinaryAt = 0, deleteFailure = false;
vault.createFolder = async path => folder(path, root);
vault.createBinary = async (path, bytes) => {
  binaryWrites++;
  if (binaryWrites === failBinaryAt) throw Error('Binary write failed');
  return vault.create(path, bytes);
};
vault.readBinary = async file => data.get(file);
vault.delete = async file => {
  if (deleteFailure) throw Error('Cleanup unavailable');
  files.delete(file.path); data.delete(file); file.parent.children = file.parent.children.filter(x=>x!==file);
};
vault.getResourcePath = file => `app://fixture/${file.path}`;
const fixture = new File([Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex')], 'photo.jpg', {type:'image/jpeg'});
const binaryPaths = () => [...files.keys()].filter(path=>path.startsWith('Attachments/') && files.get(path) instanceof TFile);
(async()=>{
  const image = await attachments.prepareImage(fixture);
  assert.equal(image.extension,'png','sniffs bytes instead of misleading name/MIME');
  for(const [bytes,ext] of [[Buffer.from([255,216,255,224]),'jpeg'],[Buffer.from('GIF89a'),'gif'],[Buffer.from('RIFFxxxxWEBP'),'webp']]) {
    assert.equal((await attachments.prepareImage(new File([bytes],'image'))).extension,ext);
  }
  await assert.rejects(()=>attachments.prepareImage(new File(['<svg/>'],'image.png',{type:'image/png'})),/Only PNG/);
  await assert.rejects(()=>attachments.prepareImage(new File([new Uint8Array(attachments.MAX_IMAGE_BYTES+1)],'huge.png')),/10 MiB/);
  const names = new Set(Array.from({length:1000},()=>attachments.attachmentFilename('png')));
  assert.equal(names.size,1000);
  for(const name of names) assert.match(name,/^private-server-\d{8}T\d{9}Z-[a-f0-9]{32}\.png$/);
  const channel = await store.createChannel(vault,manga,'Images');
  const parse = body => store.parseChannel(store.appendMessage(store.CHANNEL_TEMPLATE,body)).messages[0];
  assert.equal(parse('Old text\nSecond line').parts[0].text,'Old text\nSecond line');
  assert.equal(parse('Caption\n\n![[Attachments/example.png]]').parts.filter(x=>x.type==='image').length,1);
  assert.equal(parse('![[Attachments/example.jpeg]]').parts[0].type,'image');
  assert.equal(parse('![[Attachments/a.gif]]\n![[Attachments/b.webp]]').parts.filter(x=>x.type==='image').length,2);
  assert.equal(parse('![[Attachments/../secret.png]]').parts[0].type,'text');
  assert.equal(parse('![[https://example.com/image.png]]').parts[0].type,'text');
  await attachments.sendWithImages(vault,channel,'Still text',[]);
  assert.equal(binaryWrites,0);
  await attachments.sendWithImages(vault,channel,'',[image]);
  assert.equal(binaryPaths().length,1);
  let messages=store.parseChannel(data.get(channel)).messages;
  assert.equal(messages[1].parts[0].type,'image');
  assert(data.get(channel).includes('> ![[Attachments/private-server-'));
  assert.equal(new Uint8Array(data.get(files.get(binaryPaths()[0])))[0],137);
  await attachments.sendWithImages(vault,channel,'Caption',[image,image]);
  messages=store.parseChannel(data.get(channel)).messages;
  assert.equal(messages[2].parts.filter(x=>x.type==='image').length,2);
  assert.equal(messages[2].parts[0].text,'Caption\n\n');
  const originalPaths=binaryPaths().join('|');
  fail=true;
  await assert.rejects(()=>attachments.sendWithImages(vault,channel,'retry',[image]),/Newly created images were removed/);
  fail=false; assert.equal(binaryPaths().join('|'),originalPaths);
  failBinaryAt=binaryWrites+2;
  await assert.rejects(()=>attachments.sendWithImages(vault,channel,'partial',[image,image]),/Binary write failed/);
  assert.equal(binaryPaths().join('|'),originalPaths); failBinaryAt=0;
  const unmarked=await vault.create('Channels/Media/Manga/Unmarked.md','Existing prose');
  const count=binaryWrites;
  await assert.rejects(()=>attachments.sendWithImages(vault,unmarked,'no',[image]),/Read-only/); assert.equal(binaryWrites,count);
  assert.equal(store.parseChannel(store.CHANNEL_TEMPLATE+'unexpected content').writable,false);
  const normalProcess=vault.process;
  vault.process=async(file,fn)=>{await normalProcess(file,fn);throw Error('Reported failure after commit');};
  await attachments.sendWithImages(vault,channel,'Committed despite error',[image]);
  assert(store.parseChannel(data.get(channel)).messages.some(m=>m.body.startsWith('Committed despite error')));
  vault.process=normalProcess;
  plugin=new (load(fs.readFileSync('main.js','utf8')).default)();plugin.onload();await plugin.ribbon();await tick();
  const view=leaves[0].view;view.session.selectedPath=channel.path;view.refresh();await tick();
  const beforePreview=binaryWrites;
  await view.addImages([fixture],channel);assert.equal(binaryWrites,beforePreview,'preview does not write');
  assert.equal(view.pendingImages().length,1);assert.equal(view.sendButton.disabled,false,'image-only enabled');
  find(view.previews,el=>el.text==='Remove').onclick();assert.equal(view.pendingImages().length,0);assert.equal(binaryWrites,beforePreview);
  await view.addImages([fixture],channel);view.input.value='Keep caption';view.input.oninput();
  fail=true;await view.send();fail=false;
  assert.equal(view.input.value,'Keep caption');assert.equal(view.pendingImages().length,1);
  await view.send();await tick();assert.equal(view.input.value,'');assert.equal(view.pendingImages().length,0);
  assert(find(view.feed,el=>el.tag==='img'),'feed renders images');
  assert(!find(view.feed,el=>el.text.startsWith('![[Attachments/')),'embed syntax not shown as message text');
  await view.addImages([fixture],channel);
  const another=await store.createChannel(vault,other,'Other');await tick();view.session.selectedPath=another.path;view.refresh();await tick();
  assert.equal(view.pendingImages().length,0);view.session.selectedPath=channel.path;view.refresh();await tick();assert.equal(view.pendingImages().length,1);
  await view.onClose();assert.equal(view.previewUrls.length,0);await view.onOpen();await tick();assert.equal(view.pendingImages().length,1);
  view.input.value=''; await view.send();await tick();assert.equal(view.pendingImages().length,0,'image-only UI send');
  // Late edits that remove ownership are rechecked inside the atomic write.
  vault.process=async(file,fn)=>{data.set(file,'Unmarked external edit');return normalProcess(file,fn);};
  await assert.rejects(()=>attachments.sendWithImages(vault,channel,'no',[image]),/Read-only/);
  assert.equal(data.get(channel),'Unmarked external edit');vault.process=normalProcess;
  data.set(channel,store.CHANNEL_TEMPLATE);fail=true;deleteFailure=true;
  await assert.rejects(()=>attachments.sendWithImages(vault,channel,'cleanup failure',[image]),/could not be removed/);
  fail=false;deleteFailure=false;
  await view.onClose();
  console.log('PASS: M4 parsing, safe names/type checks, binary + Markdown writes, image-only/multiple/mixed messages, no preview writes, removal, draft preservation/retry, session pending images, late ownership changes, cleanup, committed-error recovery, and cleanup-failure reporting.');
})().catch(error=>{console.error(error);process.exitCode=1;});
