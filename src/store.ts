import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Run, Event } from './types.js';
import { redact } from './process.js';
export class Store {
  private db:DatabaseSync;
  constructor(readonly directory:string){
    mkdirSync(directory,{recursive:true});this.db=new DatabaseSync(join(directory,'orquesta.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,data TEXT NOT NULL); CREATE INDEX IF NOT EXISTS events_run ON events(run_id,seq);');
  }
  save(run:Run){run.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id,run.createdAt,JSON.stringify(run));}
  get(id:string):Run{const row=this.db.prepare('SELECT data FROM runs WHERE id=?').get(id);if(!row)throw new Error('Ejecución no encontrada: '+id);return JSON.parse(String(row.data));}
  list():Run[]{return this.db.prepare('SELECT data FROM runs ORDER BY created_at DESC').all().map(r=>JSON.parse(String(r.data)));}
  event(event:Event){const sanitize=(value:any):any=>typeof value==='string'?redact(value):Array.isArray(value)?value.map(sanitize):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,sanitize(v)])):value;const safe=sanitize(event) as Event;const result=this.db.prepare('INSERT INTO events(run_id,data) VALUES(?,?)').run(event.runId,JSON.stringify(safe));safe.seq=Number(result.lastInsertRowid);return safe;}
  events(id:string,after=0):Event[]{return this.db.prepare('SELECT seq,data FROM events WHERE run_id=? AND seq>? ORDER BY seq LIMIT 2000').all(id,after).map(r=>({...JSON.parse(String(r.data)),seq:Number(r.seq)}));}
  close(){this.db.close();}
}
