import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class Store {
  constructor(path) {
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));');
  }
  get(kind,id) {const row=this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(row.body):null;}
  all(kind) {return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>JSON.parse(r.body));}
  put(kind,id,value) {this.db.prepare('INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body').run(kind,id,JSON.stringify(value));return value;}
  close(){this.db.close();}
}
