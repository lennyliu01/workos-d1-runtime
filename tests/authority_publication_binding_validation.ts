import assert from "node:assert/strict";
import worker from "../src/index.js";
import {PUBLICATION_PATH, handlePublicationOperation, type PublicationBindingEnv} from "../src/authority_publication_binding.js";
import {ExecutorCore, type ControlPlaneProvider} from "../src/cutover_executor.js";
import {assertCandidateIssueAdmission} from "../src/runtime_invocation_client.js";

let resolutions=0,dbCalls=0;
const env:PublicationBindingEnv={
 DB:{withSession(){dbCalls++;throw new Error("unexpected DB")}},
 RUNTIME_SECRET:"fixture-business",AUTHORITY_READER_SECRET:"fixture-reader",
 AUTHORITY_PUBLICATION_MODE:"ISOLATED_ONLY",AUTHORITY_PUBLISHER_SECRET:"fixture-publisher",AUTHORITY_OWNER_SECRET:"fixture-owner",AUTHORITY_REVOKER_SECRET:"fixture-revoker",
 AUTHORITY_PUBLISHER_PRINCIPAL:"publisher",AUTHORITY_OWNER_PRINCIPAL:"owner",AUTHORITY_REVOKER_PRINCIPAL:"revoker",
 AUTHORITY_APPROVAL_VERIFIER:{async resolve(){resolutions++;return null}}
};
const request=(secret:string,body:unknown={operation:"COMMIT",requestId:"R1"},method="POST")=>new Request("https://fixture.invalid"+PUBLICATION_PATH,{method,headers:{Authorization:"Bearer "+secret},...(method==="POST"?{body:JSON.stringify(body)}:{})});
assert.equal((await handlePublicationOperation(request("fixture-publisher"),{...env,AUTHORITY_APPROVAL_VERIFIER:undefined})).status,503);
assert.equal((await handlePublicationOperation(request("fixture-publisher"),{...env,AUTHORITY_PUBLISHER_SECRET:"fixture-business"})).status,503);
assert.equal((await handlePublicationOperation(request("fixture-business"),env)).status,401);
assert.equal((await handlePublicationOperation(request("fixture-reader"),env)).status,401);
assert.equal((await handlePublicationOperation(request("fixture-owner"),env)).status,403);
assert.equal((await handlePublicationOperation(request("fixture-publisher",{operation:"ISSUE",requestId:"R1"}),env)).status,403);
assert.equal((await handlePublicationOperation(request("fixture-publisher",{operation:"COMMIT",requestId:"R1",actor:"owner"}),env)).status,400);
assert.equal((await handlePublicationOperation(request("fixture-publisher",{},"GET"),env)).status,405);
assert.equal(resolutions,0);
assert.equal((await handlePublicationOperation(request("fixture-publisher"),env)).status,403);
assert.equal(resolutions,1);assert.equal(dbCalls,0);
const direct=new Request("https://fixture.invalid/candidate/workos-persistence",{method:"POST",headers:{Authorization:"Bearer fixture-business"},body:'{"operation":"WRITE"}'});
assert.equal((await worker.fetch(direct,env as any)).status,403);
assert.equal(dbCalls,0);
assert.throws(()=>assertCandidateIssueAdmission({issue:{number:1,title:"[RUNTIME_INVOCATION] READ",body:"Execution_Surface: CHAT\nTrigger_Mode: HUMAN\nOperation: READ\nTask_ID: T\nCaller_Identity: C\nDataset_ID: D\nInstance_ID: I\nSelector: CURRENT"}}),/ADMISSION_UNBOUND/);
const core=new ExecutorCore({} as ControlPlaneProvider);
assert.deepEqual(await core.executeD1Publication("R1","COMMIT"),{status:"DENIED"});
let invoked=0;
const bound=new ExecutorCore({} as ControlPlaneProvider,async(op,id)=>{invoked++;assert.equal(op,"COMMIT");assert.equal(id,"R1");return {status:"UNKNOWN"}});
assert.deepEqual(await bound.executeD1Publication("R1","COMMIT"),{status:"UNKNOWN"});
assert.equal(invoked,1);
console.log("AUTHORITY_PUBLICATION_BINDING_NEGATIVE_MOCK_PASS");
