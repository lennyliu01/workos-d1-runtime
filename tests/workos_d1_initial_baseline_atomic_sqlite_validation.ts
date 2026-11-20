import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { atomicInitialBaselineInsert } from "../src/workos_d1_initial_baseline_transaction.js";
import { sha256PayloadHex } from "../src/workos_canonical_payload.js";

/**
 * Real SQLite query/constraint/rollback verification, NOT a mock D1 writer.
 * Checks the exact additive migration and transaction SQL against SQLite.
 * Does not call remote Cloudflare/D1 or apply production migrations.
 */
const sqlite=new DatabaseSync(":memory:");
sqlite.exec(`
  CREATE TABLE workos_current_state_versions(
    dataset_id TEXT NOT NULL,instance_id TEXT NOT NULL,
    version INTEGER NOT NULL,previous_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,invocation_id TEXT NOT NULL UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,db_written_at TEXT NOT NULL,
    PRIMARY KEY(dataset_id,instance_id,version)
  );
`);
const migration=readFileSync(new URL("../migrations/20261120_r3_initial_baseline_consumptions.sql",import.meta.url),"utf8");
sqlite.exec(migration);
type Bound={sql:string;args:unknown[]};
const db={
  prepare(sql:string){
    return {bind(...args:unknown[]):Bound&{bind(...args:unknown[]):any}{
      return {sql,args,bind(){throw new Error("DOUBLE_BIND");}};
    }};
  },
  async batch(statements:Bound[]){
    sqlite.exec("BEGIN IMMEDIATE");
    try{
      const out=statements.map(s=>{
        const info=sqlite.prepare(s.sql).run(...(s.args as any[]));
        return{success:true,meta:{changes:Number(info.changes)}};
      });
      sqlite.exec("COMMIT");
      return out;
    }catch(e){sqlite.exec("ROLLBACK");throw e;}
  },
};
const scope=(instanceId:string,idempotencyKey:string)=>({
 authorityFingerprint:"TEST-FROZEN-SCOPE",activationEpoch:"11",
 manifestId:"MAN-BATCH07",datasetId:"RW_CURRENT_STATE" as const,
 instanceId,idempotencyKey,
});
const rows=()=>Number((sqlite.prepare("SELECT count(*) AS n FROM workos_current_state_versions").get() as any).n);
const grants=()=>Number((sqlite.prepare("SELECT count(*) AS n FROM workos_initial_baseline_consumptions").get() as any).n);
const source="{\"Company_ID\":\"DSG\"}";
const sha=await sha256PayloadHex(source);
const first="9d4362b0-f6f4-4f85-b42a-f2342a02dc4b";
await atomicInitialBaselineInsert(db,scope("DSG","grant-DSG"),source,sha,first);
assert.equal(rows(),1);assert.equal(grants(),1);
const latest=sqlite.prepare(
 "SELECT a.invocation_id AS state_id,b.invocation_id AS grant_id,a.payload_json AS state_payload "+
 "FROM workos_current_state_versions a JOIN workos_initial_baseline_consumptions b "+
 "ON a.invocation_id=b.invocation_id WHERE a.dataset_id='RW_CURRENT_STATE' AND a.instance_id='DSG'"
).get() as any;
assert.equal(latest.state_id,first);
assert.equal(latest.grant_id,first);
assert.equal(latest.state_payload,source);
console.log("PASS SQLite committed exactly one state and one matching consumption");
await assert.rejects(()=>atomicInitialBaselineInsert(db,scope("DSG","grant-DSG-2"),
 source,sha,"fc114f0f-63b2-4e0e-a8a4-cf99f2e72c37"));
assert.equal(rows(),1);assert.equal(grants(),1);
console.log("PASS stale v0 rejected without consuming a second grant");
await assert.rejects(()=>atomicInitialBaselineInsert(db,scope("DSG","grant-DSG"),
 source,sha,"cdf7ccb0-c82e-4543-8147-adeb9ee290da"));
assert.equal(rows(),1);assert.equal(grants(),1);
console.log("PASS replay transaction cannot duplicate the original consumption");
sqlite.prepare(
 "INSERT INTO workos_initial_baseline_consumptions "+
 "(authority_scope_fingerprint,activation_epoch,manifest_id,dataset_id,instance_id,"+
 "idempotency_key,payload_sha256,invocation_id,db_consumed_at) "+
 "VALUES (?,?,?,?,?,?,?,?,?)"
).run("TEST-FROZEN-SCOPE","11","MAN-BATCH07","RW_CURRENT_STATE","DOL",
 "old-grant-DOL",sha,"72e9c6c3-37ed-4a15-a296-cf6dbf32e0b9","TEST");
await assert.rejects(()=>atomicInitialBaselineInsert(db,scope("DOL","grant-DOL-new"),
 source,sha,"e52b5dae-d75b-4112-b6d0-5236ea194d99"));
assert.equal(rows(),1);assert.equal(grants(),2);
console.log("PASS consumed grant scope collision rolls back newly inserted v1");
sqlite.close();
console.log("R3_REAL_SQLITE_ATOMIC_CONSUMPTION_TESTS_PASS");
