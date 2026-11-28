// Local SQLite-backed D1-shaped adapter. NOT Wrangler or real Provider Conformance.
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const {publicationEnvelope,publicationAttempt,publicationStatus,readAuthorityGeneration}=require('../build/authority_boundary_candidate.js');
const {authorityRoute,selectedAuthorityRows,LEGACY_AUTHORITY_LOCATOR,D1_AUTHORITY_LOCATOR}=require('../build/authority_selector_candidate.js');
const schema=fs.readFileSync('migrations/0004_candidate_authority_publication_boundary.sql','utf8');
const e10=['fixture-scope','cut-10',10,'registry-10','manifest-10','gate-10','workflow-10','time-10'];
const e11=['fixture-scope','cut-11',11,'registry-11','manifest-11','gate-11','workflow-11','time-11'];
const deps10='{"registryFile":"fixture-registry-10","acceptance":"fixture-ab-10"}';
const deps11='{"registryFile":"fixture-registry-11","acceptance":"fixture-ab-11"}';
const frozen='{"identity":"fixture-only"}';
let pass=0;
function fresh(){
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON;'+schema);
  db.prepare('INSERT INTO authority_boundary_seed VALUES (1,?,?)').run(JSON.stringify(e10),deps10);
  return db;
}
function req(id,over={}){return {grantId:`g-${id}`,requestId:`r-${id}`,publisher:'fixture-publisher',sessionId:`s-${id}`,expected:e10,target:e11,expectedDependencies:deps10,targetDependencies:deps11,frozenIdentity:frozen,changeSpecId:'fixture-change',pcvId:'fixture-pcv',faa2Id:'fixture-faa2',...over};}
function grant(db,r,expires=Math.floor(Date.now()/1000)+3600){db.prepare('INSERT INTO authority_boundary_grant VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(r.grantId,r.requestId,r.publisher,r.sessionId,'fixture-revoker',JSON.stringify(r.expected),JSON.stringify(r.target),r.expectedDependencies,r.targetDependencies,r.frozenIdentity,r.changeSpecId,r.pcvId,r.faa2Id,expires);}
const ctx=(r,actor=r.publisher,over={})=>({actor,sessionId:r.sessionId,frozenIdentity:r.frozenIdentity,eligible:true,...over});
function adapter(db,fault=''){
  let writes=0,primary=0;
  const prepare=(sql)=>{let args=[];return {bind(...a){args=a;return this},async first(){if(fault==='unreadable')throw Error('read lost');return db.prepare(sql).get(...args)??null},async run(){writes++;if(fault==='before-terminal'&&sql.includes('INSERT INTO authority_boundary_terminal'))throw Error('precommit failure');const result=db.prepare(sql).run(...args);if((fault==='lost-terminal'&&sql.includes('INSERT INTO authority_boundary_terminal'))||(fault==='lost-claim'&&sql.includes('INSERT INTO authority_boundary_started')))throw Error('response lost');return {success:true,meta:{changes:Number(result.changes)}}}}};
  return {prepare,withSession(s){assert.equal(s,'first-primary');primary++;return {prepare}},get writes(){return writes},get primary(){return primary}};
}
function count(db,table){return db.prepare('SELECT count(*) AS n FROM '+table).get().n}
function test(name,fn){return Promise.resolve().then(fn).then(()=>{pass++;console.log('PASS',name)})}
(async()=>{
 await test('complete tuple commit, dependencies, durable receipt, one terminal, exact replay no write',async()=>{
   const d=fresh(),r=req('1');grant(d,r);const a=adapter(d);const x=await publicationAttempt(a,r,ctx(r),'COMMITTED');assert.equal(x.status,'COMMITTED');assert.deepEqual((await readAuthorityGeneration(a)).tuple,e11);assert.equal((await readAuthorityGeneration(a)).dependenciesJson,deps11);assert.equal(x.receipt.envelope,publicationEnvelope(r));const n=a.writes;assert.deepEqual(await publicationAttempt(a,r,ctx(r),'COMMITTED'),x);assert.equal(a.writes,n);assert.equal(count(d,'authority_boundary_terminal'),1);assert(a.primary>0);
 });
 await test('each predecessor field and companion drift rejected, no terminal/epoch move',async()=>{
   for(const i of [0,1,2,3,4,5,6,7,8]){const d=fresh();const exp=[...e10],tar=[...e11];if(i===2){exp[2]=9;tar[2]=10;}else if(i<8){exp[i]='wrong';if(i===0)tar[0]='wrong';}const r=req('x'+i,{expected:exp,target:tar,expectedDependencies:i===8?'{"registryFile":"wrong","acceptance":"fixture-ab-10"}':deps10});grant(d,r);assert.notEqual((await publicationAttempt(adapter(d),r,ctx(r),'COMMITTED')).status,'COMMITTED');assert.equal(count(d,'authority_boundary_terminal'),0);assert.equal(d.prepare('SELECT epoch FROM authority_boundary_current').get().epoch,10);}
 });
 await test('wrong target epoch rejected before write',async()=>{const d=fresh(),r=req('wrong',{target:[...e11.slice(0,2),12,...e11.slice(3)]});const a=adapter(d);assert.equal((await publicationAttempt(a,r,ctx(r),'COMMITTED')).status,'CONFLICT');assert.equal(a.writes,0)});
 await test('wrong frozen identity, business actor, wrong session, expired grant, mismatched request rejected',async()=>{
   const d=fresh(),r=req('2');grant(d,r);const a=adapter(d);assert.equal((await publicationAttempt(a,r,ctx(r,r.publisher,{frozenIdentity:'{}'}),'COMMITTED')).status,'DENIED');assert.equal((await publicationAttempt(a,r,ctx(r,'ordinary-business'),'COMMITTED')).status,'DENIED');assert.equal((await publicationAttempt(a,r,ctx(r,r.publisher,{sessionId:'wrong'}),'COMMITTED')).status,'DENIED');const changed={...r,pcvId:'different'};assert.equal((await publicationAttempt(a,changed,ctx(changed),'COMMITTED')).status,'CONFLICT');const expired=req('expired');grant(d,expired,1);assert.notEqual((await publicationAttempt(a,expired,ctx(expired),'COMMITTED')).status,'COMMITTED');assert.equal(count(d,'authority_boundary_terminal'),0);
 });
 await test('precommit failure -> UNKNOWN, exact repeat cannot redispatch; revoke closes late request',async()=>{
   const d=fresh(),r=req('3');grant(d,r);const a=adapter(d,'before-terminal');assert.equal((await publicationAttempt(a,r,ctx(r),'COMMITTED')).status,'UNKNOWN');assert.equal(count(d,'authority_boundary_started'),1);assert.equal(count(d,'authority_boundary_terminal'),0);const b=adapter(d);assert.equal((await publicationAttempt(b,r,ctx(r),'COMMITTED')).status,'UNKNOWN');assert.equal(b.writes,1);assert.equal((await publicationAttempt(b,r,ctx(r,'fixture-revoker'),'CANCELED')).status,'CANCELED');assert.equal((await publicationAttempt(b,r,ctx(r),'COMMITTED')).status,'CANCELED');assert.equal(d.prepare('SELECT epoch FROM authority_boundary_current').get().epoch,10);
 });
 await test('response loss after commit recovered exact receipt, lost dispatch stays UNKNOWN',async()=>{
   const d=fresh(),r=req('4');grant(d,r);assert.equal((await publicationAttempt(adapter(d,'lost-terminal'),r,ctx(r),'COMMITTED')).status,'COMMITTED');assert.equal((await publicationStatus(adapter(d),r,ctx(r))).status,'COMMITTED');const e=fresh(),q=req('5');grant(e,q);assert.equal((await publicationAttempt(adapter(e,'lost-claim'),q,ctx(q),'COMMITTED')).status,'UNKNOWN');assert.equal(count(e,'authority_boundary_started'),1);assert.equal(count(e,'authority_boundary_terminal'),0);
 });
 await test('different grant with stale predecessor, delayed old request, replay content conflict',async()=>{
   const d=fresh(),r=req('6'),q=req('7');grant(d,r);grant(d,q);const a=adapter(d);assert.equal((await publicationAttempt(a,r,ctx(r),'COMMITTED')).status,'COMMITTED');assert.equal((await publicationAttempt(a,q,ctx(q),'COMMITTED')).status,'UNKNOWN');assert.equal((await publicationStatus(a,{...r,changeSpecId:'wrong'},ctx(r))).status,'CONFLICT');assert.equal((await publicationStatus(a,req('missing'),ctx(req('missing')))).status,'UNKNOWN');assert.equal(d.prepare('SELECT epoch FROM authority_boundary_current').get().epoch,11);
 });
 await test('revocation before claim, expired and one-shot session uniqueness, SQL immutable records',async()=>{
   const d=fresh(),r=req('8');grant(d,r);const a=adapter(d);assert.equal((await publicationAttempt(a,r,ctx(r,'fixture-revoker'),'CANCELED')).status,'CANCELED');assert.equal((await publicationAttempt(a,r,ctx(r),'COMMITTED')).status,'CANCELED');assert.throws(()=>grant(d,req('9',{sessionId:r.sessionId})));assert.throws(()=>d.exec('DELETE FROM authority_boundary_terminal'));assert.throws(()=>d.exec('UPDATE authority_boundary_grant SET expires_unix=9999999999'));assert.throws(()=>d.exec('DELETE FROM authority_boundary_seed'));assert.equal(count(d,'authority_boundary_started'),0);
 });
 await test('selector exact one, legacy then D1, never fallback on error, duplicate roots denied',async()=>{
   const line=x=>'- `Repository_Cutover_Control` / singleton `Authority_Publication` — `'+x+'`';let old=0,next=0;const rd={readSheet:async()=>{old++;return [['old']]},readD1AuthorityPublication:async()=>{next++;return [['new']]}};assert.equal(authorityRoute(line(LEGACY_AUTHORITY_LOCATOR)),'SHEETS');assert.deepEqual(await selectedAuthorityRows(line(LEGACY_AUTHORITY_LOCATOR),rd),[['old']]);assert.deepEqual(await selectedAuthorityRows(line(D1_AUTHORITY_LOCATOR),rd),[['new']]);assert.equal(old,1);assert.equal(next,1);await assert.rejects(()=>selectedAuthorityRows(line(D1_AUTHORITY_LOCATOR),{readSheet:rd.readSheet}));await assert.rejects(()=>selectedAuthorityRows(line(D1_AUTHORITY_LOCATOR),{...rd,readD1AuthorityPublication:async()=>{throw Error('unavailable')}}));await assert.rejects(()=>selectedAuthorityRows(line(LEGACY_AUTHORITY_LOCATOR)+'\n'+line(D1_AUTHORITY_LOCATOR),rd));await assert.rejects(()=>selectedAuthorityRows('',rd));assert.equal(old,1);assert.equal(next,1);
 });
 console.log(`${pass} local adapter test groups PASS`);
})().catch(e=>{console.error(e);process.exitCode=1});
