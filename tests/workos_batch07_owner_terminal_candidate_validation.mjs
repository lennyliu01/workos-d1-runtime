// Isolated production-denied real SQLite test. No external credentials.
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {
  submitCandidateOwnerDecision,SCOPE_KEY,CODE_HEAD,REGISTRY_CONTRACT_FINGERPRINT
} from "../src/workos_batch07_owner_terminal_candidate.ts";

const migration=readFileSync(new URL("../migrations/20261121_batch07_owner_terminal_candidate.sql",import.meta.url),"utf8");
const NOW=Date.parse("2026-11-21T08:00:00Z");
const ITEMS=["EIGHT_FIELD_NULL_SEMANTICS","FROZEN_RESEARCH_FIDELITY",
  "ROLE_DECODER_AND_UNACCEPTED_FACT_EXCLUSION","DATASET_INSTANCE_IDENTITY",
  "D1_INITIALIZATION_WRITE_AND_VERSION1_READBACK_CONTRACT"];
const binding={
  state:"ACTIVE",scopeKey:SCOPE_KEY,owner:"ROLLING_WEDGE_WORKFLOW",
  datasetId:"RW_CURRENT_STATE",instances:["DSG","DOL","WSP","GIBA","NA","ENB","ATD"],
  fields:["Company_ID","Company_Name","Ticker","Exchange","Currency","State_As_Of",
    "Base_Source_Materials","Structured_State_Content"],
  candidateCodeSha:CODE_HEAD,registryContractFingerprint:REGISTRY_CONTRACT_FINGERPRINT,
  sealedChangeSpecSha256:"a".repeat(64),frozenSubjectSha256:"b".repeat(64),
  provider:"MOCK_ONLY",authorizedHumanProviderId:"human-1",
  authorizationIssuerRef:"workos-root",nativeEventVerifierRef:"independent-verifier",
  notBefore:"2026-11-20T00:00:00Z",expiresAt:"2026-11-23T00:00:00Z",
};
function event(overall="ACCEPT",id="e1"){
  return {provider:binding.provider,nativeEventId:id,nativeEventDigest:"c".repeat(64),
    attributableHumanProviderId:binding.authorizedHumanProviderId,
    nativeEventAt:"2026-11-21T07:00:00Z",authorizedIssuerRef:binding.authorizationIssuerRef,
    verifierRef:binding.nativeEventVerifierRef,evidenceAnchorRef:"immutable-anchor",
    exactSubjectSha256:binding.frozenSubjectSha256,
    fiveChecks:ITEMS.map((item,i)=>({item,decision:overall==="REJECT"&&i===2?"REJECT":"ACCEPT"})),
    overall,revoked:false};
}
function fixture(){
  const db=new DatabaseSync(":memory:");db.exec(migration);
  const d1={prepare(sql){const s=db.prepare(sql);let args=[];return {
    bind(...values){args=values;return this;},
    async run(){const r=s.run(...args);return {success:true,meta:{changes:r.changes}};},
    async first(){return s.get(...args)??null;},
  }}};
  return {db,d1};
}
function deps(d1,b=binding,e=event()){
  return {db:d1,authority:{async readExactBinding(){return b}},
    events:{async verifyExact(ref){return ref==="native-ref"?e:null}}};
}
async function denied(label,promise,error){
  await assert.rejects(promise(),e=>e.message===error,label);
}
{
  const {db,d1}=fixture();
  assert.equal((await submitCandidateOwnerDecision("native-ref",deps(d1),NOW)).status,"COMMITTED_VERIFIED");
  await denied("replay",()=>submitCandidateOwnerDecision("native-ref",deps(d1),NOW),
    "OWNER_TERMINAL_CONFLICT_OR_UNCERTAIN");
  await denied("conflicting reject",()=>submitCandidateOwnerDecision("native-ref",
    deps(d1,binding,event("REJECT","e2")),NOW),"OWNER_TERMINAL_CONFLICT_OR_UNCERTAIN");
  assert.equal(db.prepare("SELECT count(*) AS n FROM workos_batch07_owner_terminal_decision").get().n,1);
  assert.equal(db.prepare("SELECT decision FROM workos_batch07_owner_terminal_decision").get().decision,"ACCEPT");
  assert.throws(()=>db.exec("UPDATE workos_batch07_owner_terminal_decision SET decision='REJECT'"),
    /OWNER_TERMINAL_IMMUTABLE/);
  assert.throws(()=>db.exec("DELETE FROM workos_batch07_owner_terminal_decision"),
    /OWNER_TERMINAL_IMMUTABLE/);
  db.close();
}
{
  const {db,d1}=fixture();
  const bad=[
    ["inactive",{...binding,state:"DRAFT"},event(),"OWNER_AUTHORITY_NOT_ACTIVE_OR_EXPIRED"],
    ["wrong code",{...binding,candidateCodeSha:"d".repeat(40)},event(),"OWNER_AUTHORITY_NOT_ACTIVE_OR_EXPIRED"],
    ["wrong actor",binding,{...event(),attributableHumanProviderId:"other"},"OWNER_NATIVE_EVENT_NOT_VERIFIED"],
    ["revoked",binding,{...event(),revoked:true},"OWNER_NATIVE_EVENT_NOT_VERIFIED"],
    ["wrong subject",binding,{...event(),exactSubjectSha256:"d".repeat(64)},"OWNER_NATIVE_EVENT_NOT_VERIFIED"],
    ["missing check",binding,{...event(),fiveChecks:event().fiveChecks.slice(0,4)},"OWNER_NATIVE_EVENT_NOT_VERIFIED"],
    ["mismatched total",binding,{...event(),overall:"REJECT"},"OWNER_NATIVE_EVENT_NOT_VERIFIED"],
  ];
  for(const [label,b,e,error] of bad)
    await denied(label,()=>submitCandidateOwnerDecision("native-ref",deps(d1,b,e),NOW),error);
  await denied("expired",()=>submitCandidateOwnerDecision("native-ref",deps(d1,binding),
    Date.parse("2026-12-24T00:00:00Z")),"OWNER_AUTHORITY_NOT_ACTIVE_OR_EXPIRED");
  await denied("unverified event",()=>submitCandidateOwnerDecision("untrusted",deps(d1),NOW),
    "OWNER_NATIVE_EVENT_NOT_VERIFIED");
  assert.equal(db.prepare("SELECT count(*) AS n FROM workos_batch07_owner_terminal_decision").get().n,0);
  db.close();
}
console.log("PASS: Batch07 real SQLite one-terminal; replay/conflict, actor, scope, expiry, revocation and five checks");
