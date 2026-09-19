import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path';
type Entry={path:string; existed:boolean; content?:string; postHash?:string}; type Checkpoint={entries:Entry[]};
const hash=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
export class WorkspaceCheckpointStore {
  constructor(private readonly home:string) {}
  private file(root:string){return path.join(this.home,'.moderado','checkpoints',crypto.createHash('sha256').update(root).digest('hex')+'.json');}
  capture(root:string, paths:string[]){const entries=paths.map(p=>{const f=path.join(root,p); const existed=fs.existsSync(f); return {path:p,existed,content:existed?fs.readFileSync(f,'utf8'):undefined};}); const target=this.file(root); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,JSON.stringify({entries}), 'utf8');}
  recordPostWrite(root:string, paths:string[]){const target=this.file(root); const data=JSON.parse(fs.readFileSync(target,'utf8')) as Checkpoint; for(const entry of data.entries.filter(e=>paths.includes(e.path))){const f=path.join(root,entry.path); entry.postHash=fs.existsSync(f)?hash(fs.readFileSync(f,'utf8')):'absent';} fs.writeFileSync(target,JSON.stringify(data),'utf8');}
  restoreLatest(root:string){const target=this.file(root); if(!fs.existsSync(target)) return {restored:[],conflicts:[]}; const data=JSON.parse(fs.readFileSync(target,'utf8')) as Checkpoint; const conflicts=data.entries.filter(e=>{const f=path.join(root,e.path); return (fs.existsSync(f)?hash(fs.readFileSync(f,'utf8')):'absent')!==e.postHash;}).map(e=>e.path); if(conflicts.length)return {restored:[],conflicts}; for(const e of data.entries){const f=path.join(root,e.path); if(e.existed){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,e.content??'','utf8');}else if(fs.existsSync(f))fs.unlinkSync(f);} return {restored:data.entries.map(e=>e.path),conflicts:[]};}
}
