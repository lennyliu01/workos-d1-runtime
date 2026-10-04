import { assertCapability, capabilitiesFor, type CapabilityName, type ExecutionContextId } from "./workos_capability_profiles.js";

export interface ResponsesClient { responses: { create(input: Record<string, unknown>): Promise<any> } }
export interface ModelToolHandlers {
  workosRead(a: Record<string, unknown>): Promise<unknown>;
  workosWrite(a: Record<string, unknown>): Promise<unknown>;
  marketQuote(a: Record<string, unknown>): Promise<unknown>;
  sourceVerify(a: Record<string, unknown>): Promise<unknown>;
}
export interface ModelContextRequest {
  context: ExecutionContextId; taskId: string; callerIdentity: string;
  instructionText: string; runtimeProfileText: string; input: unknown; kind: "WORKFLOW" | "ROLE";
}
export interface WorkflowStep { kind: "DISPATCH_ROLE" | "STOP" | "BLOCKED"; role: string | null; payload: Record<string, unknown>; reason: string | null }
export interface RoleResult { kind: "ROLE_RESULT"; status: "COMPLETED" | "PARTIAL" | "FAILED" | "BLOCKED"; return_target: "WORKFLOW"; payload: Record<string, unknown>; reason: string | null }

const MODEL = "gpt-5.6";
const EXPECTED_REPO = "lennyliu01/workos-d1-runtime";
const EXPECTED_REF = "refs/heads/main";
const EXPECTED_WORKFLOW_REF = "lennyliu01/workos-d1-runtime/.github/workflows/workos-business-executor.yml@refs/heads/main";

function need(env: Record<string,string|undefined>, key: string): string {
  const v=env[key]; if(!v) throw new Error(`OPENAI_IDENTITY_CONFIG_MISSING:${key}`); return v;
}
export function loadOpenAIWorkloadIdentityConfig(env: Record<string,string|undefined>) {
  if(env.GITHUB_REPOSITORY!==EXPECTED_REPO) throw new Error("OPENAI_IDENTITY_REPOSITORY_CLAIM_MISMATCH");
  if(env.GITHUB_REF!==EXPECTED_REF) throw new Error("OPENAI_IDENTITY_REF_CLAIM_MISMATCH");
  if(env.GITHUB_WORKFLOW_REF!==EXPECTED_WORKFLOW_REF) throw new Error("OPENAI_IDENTITY_WORKFLOW_CLAIM_MISMATCH");
  return {
    audience: need(env,"OPENAI_WIF_AUDIENCE"), provider: need(env,"OPENAI_IDENTITY_PROVIDER_ID"),
    serviceAccount: need(env,"OPENAI_SERVICE_ACCOUNT_ID"), exchangeUrl: need(env,"OPENAI_WIF_TOKEN_EXCHANGE_URL"),
    oidcUrl: need(env,"ACTIONS_ID_TOKEN_REQUEST_URL"), oidcToken: need(env,"ACTIONS_ID_TOKEN_REQUEST_TOKEN"),
  };
}
export async function acquireOpenAIAccessToken(env: Record<string,string|undefined>, fetchImpl: typeof fetch=fetch): Promise<string> {
  const c=loadOpenAIWorkloadIdentityConfig(env); const u=new URL(c.oidcUrl); u.searchParams.set("audience",c.audience);
  const r=await fetchImpl(u,{headers:{Authorization:`Bearer ${c.oidcToken}`}}); if(!r.ok) throw new Error(`GITHUB_OIDC_TOKEN_FAILED:${r.status}`);
  const j=await r.json() as any; if(!j.value) throw new Error("GITHUB_OIDC_TOKEN_MISSING");
  const x=await fetchImpl(c.exchangeUrl,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({
    grant_type:"urn:ietf:params:oauth:grant-type:token-exchange",subject_token_type:"urn:ietf:params:oauth:token-type:jwt",
    requested_token_type:"urn:ietf:params:oauth:token-type:access_token",subject_token:j.value,audience:c.audience,
    identity_provider_id:c.provider,service_account_id:c.serviceAccount,
  })}); if(!x.ok) throw new Error(`OPENAI_WIF_TOKEN_EXCHANGE_FAILED:${x.status}`);
  const b=await x.json() as any; if(!b.access_token) throw new Error("OPENAI_WIF_ACCESS_TOKEN_MISSING"); return b.access_token;
}
export function createResponsesClient(token:string, fetchImpl:typeof fetch=fetch):ResponsesClient {
  if(!token) throw new Error("OPENAI_ACCESS_TOKEN_MISSING");
  return {responses:{create:async(input)=>{const r=await fetchImpl("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify(input)});if(!r.ok)throw new Error(`OPENAI_RESPONSES_FAILED:${r.status}`);return r.json();}}};
}

function txt(r:any):string { if(typeof r?.output_text==="string") return r.output_text; for(const i of r?.output??[]) for(const c of i?.content??[]) if(typeof c?.text==="string") return c.text; throw new Error("MODEL_OUTPUT_TEXT_MISSING"); }
function payload(s:any, code:string):Record<string,unknown>{try{const x=JSON.parse(s);if(!x||typeof x!=="object"||Array.isArray(x))throw 0;return x;}catch{throw new Error(code)}}
function parseResult(kind:"WORKFLOW"|"ROLE", text:string):WorkflowStep|RoleResult {
  let x:any; try{x=JSON.parse(text)}catch{throw new Error(kind==="WORKFLOW"?"MODEL_WORKFLOW_OUTPUT_INVALID":"MODEL_ROLE_RESULT_INVALID")}
  if(kind==="WORKFLOW"){
    if(!x||!["DISPATCH_ROLE","STOP","BLOCKED"].includes(x.kind)||!(x.reason===null||typeof x.reason==="string")) throw new Error("MODEL_WORKFLOW_OUTPUT_INVALID");
    if(x.kind==="DISPATCH_ROLE"?(typeof x.role!=="string"||!x.role):x.role!==null) throw new Error("MODEL_WORKFLOW_OUTPUT_INVALID");
    return {kind:x.kind,role:x.role,payload:payload(x.payload_json,"MODEL_WORKFLOW_OUTPUT_INVALID"),reason:x.reason};
  }
  if(!x||x.kind!=="ROLE_RESULT"||x.return_target!=="WORKFLOW"||!["COMPLETED","PARTIAL","FAILED","BLOCKED"].includes(x.status)) throw new Error("MODEL_ROLE_RESULT_INVALID");
  return {kind:"ROLE_RESULT",status:x.status,return_target:"WORKFLOW",payload:payload(x.payload_json,"MODEL_ROLE_RESULT_INVALID"),reason:x.reason??null};
}
function localTools(context:ExecutionContextId){const c=capabilitiesFor(context);const t:any[]=[];if(c.has("web_search"))t.push({type:"web_search"});for(const n of ["workos_read","workos_write","market_quote","source_verify"] as CapabilityName[])if(c.has(n))t.push({type:"function",name:n,strict:true,parameters:{type:"object",additionalProperties:true}});return t;}
async function callTool(context:ExecutionContextId, call:any, h:ModelToolHandlers){const m:any={workos_read:["workos_read",h.workosRead],workos_write:["workos_write",h.workosWrite],market_quote:["market_quote",h.marketQuote],source_verify:["source_verify",h.sourceVerify]};const e=m[call.name];if(!e)throw new Error(`MODEL_TOOL_UNKNOWN:${call.name}`);assertCapability(context,e[0]);let a={};try{a=JSON.parse(call.arguments??"{}")}catch{throw new Error("MODEL_TOOL_ARGUMENTS_INVALID")};return e[1](a);}
const WF_SCHEMA={type:"object",additionalProperties:false,properties:{kind:{type:"string",enum:["DISPATCH_ROLE","STOP","BLOCKED"]},role:{type:["string","null"]},payload_json:{type:"string"},reason:{type:["string","null"]}},required:["kind","role","payload_json","reason"]};
const ROLE_SCHEMA={type:"object",additionalProperties:false,properties:{kind:{type:"string",enum:["ROLE_RESULT"]},status:{type:"string",enum:["COMPLETED","PARTIAL","FAILED","BLOCKED"]},return_target:{type:"string",enum:["WORKFLOW"]},payload_json:{type:"string"},reason:{type:["string","null"]}},required:["kind","status","return_target","payload_json","reason"]};
export async function runStructuredModelContext(client:ResponsesClient, q:ModelContextRequest, h:ModelToolHandlers):Promise<WorkflowStep|RoleResult>{
  let input:any=["Execute only the registered WorkOS contract. Do not invent identities or transitions.",`Task_ID: ${q.taskId}`,`Caller_Identity: ${q.callerIdentity}`,q.instructionText,q.runtimeProfileText,JSON.stringify(q.input)].join("\n\n"), prev:string|undefined;
  for(let n=0;n<12;n++){const r=await client.responses.create({model:MODEL,input,...(prev?{previous_response_id:prev}:{}),tools:localTools(q.context),parallel_tool_calls:false,text:{format:{type:"json_schema",name:q.kind==="WORKFLOW"?"workos_workflow_step":"workos_role_result",strict:true,schema:q.kind==="WORKFLOW"?WF_SCHEMA:ROLE_SCHEMA}}});const calls=(r.output??[]).filter((i:any)=>i?.type==="function_call");if(!calls.length)return parseResult(q.kind,txt(r));const outs=[];for(const c of calls)outs.push({type:"function_call_output",call_id:String(c.call_id),output:JSON.stringify(await callTool(q.context,c,h))});prev=String(r.id??"");if(!prev)throw new Error("MODEL_RESPONSE_ID_MISSING");input=outs;}throw new Error("MODEL_CONTEXT_STEP_LIMIT");
}
export async function runBoundedWebLookup(client:ResponsesClient,input:{purpose:"MARKET_QUOTE"|"SOURCE_VERIFY";query:Record<string,unknown>}){const r=await client.responses.create({model:MODEL,tools:[{type:"web_search"}],input:`Bounded ${input.purpose}: ${JSON.stringify(input.query)}`});return{status:"SUCCESS" as const,text:txt(r)}}
