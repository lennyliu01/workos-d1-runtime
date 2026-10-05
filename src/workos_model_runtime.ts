import OpenAI from "openai";
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
  if(env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY_FORBIDDEN_FOR_WORKLOAD_IDENTITY");
  if(env.GITHUB_REPOSITORY!==EXPECTED_REPO) throw new Error("OPENAI_IDENTITY_REPOSITORY_CLAIM_MISMATCH");
  if(env.GITHUB_REF!==EXPECTED_REF) throw new Error("OPENAI_IDENTITY_REF_CLAIM_MISMATCH");
  if(env.GITHUB_WORKFLOW_REF!==EXPECTED_WORKFLOW_REF) throw new Error("OPENAI_IDENTITY_WORKFLOW_CLAIM_MISMATCH");
  return {
    audience: need(env,"OPENAI_WIF_AUDIENCE"),
    identityProviderId: need(env,"OPENAI_IDENTITY_PROVIDER_ID"),
    serviceAccountId: need(env,"OPENAI_SERVICE_ACCOUNT_ID"),
    oidcUrl: need(env,"ACTIONS_ID_TOKEN_REQUEST_URL"),
    oidcToken: need(env,"ACTIONS_ID_TOKEN_REQUEST_TOKEN"),
  };
}

async function githubOIDCSubjectToken(config: ReturnType<typeof loadOpenAIWorkloadIdentityConfig>, fetchImpl: typeof fetch): Promise<string> {
  const u=new URL(config.oidcUrl); u.searchParams.set("audience",config.audience);
  const r=await fetchImpl(u,{headers:{Authorization:`Bearer ${config.oidcToken}`}});
  if(!r.ok) throw new Error(`GITHUB_OIDC_TOKEN_FAILED:${r.status}`);
  const j=await r.json() as { value?: string };
  if(!j.value) throw new Error("GITHUB_OIDC_TOKEN_MISSING");
  return j.value;
}

export function createResponsesClientFromWorkloadIdentity(
  env: Record<string,string|undefined>,
  fetchImpl: typeof fetch=fetch,
): ResponsesClient {
  const c=loadOpenAIWorkloadIdentityConfig(env);
  const client=new OpenAI({
    apiKey:null,
    workloadIdentity:{
      identityProviderId:c.identityProviderId,
      serviceAccountId:c.serviceAccountId,
      provider:{tokenType:"jwt",getToken:()=>githubOIDCSubjectToken(c,fetchImpl)},
    },
    fetch:fetchImpl,
  });
  return {responses:{create:(input)=>client.responses.create(input as any)}};
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

const NULLABLE_STRING={type:["string","null"]};
const WORKOS_READ_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{
    dataset_id:{type:"string",minLength:1},instance_id:{type:"string",minLength:1},
    selector_kind:{type:"string",enum:["CURRENT","RECORD","AFTER","TAIL"]},
    record_key:NULLABLE_STRING,checkpoint_record_key:NULLABLE_STRING,
    limit:{type:["integer","null"],minimum:1,maximum:100},logical_k1:NULLABLE_STRING,
  },
  required:["dataset_id","instance_id","selector_kind","record_key","checkpoint_record_key","limit","logical_k1"],
};
const WORKOS_WRITE_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{
    dataset_id:{type:"string",minLength:1},instance_id:{type:"string",minLength:1},
    logical_output_id:{type:"string",minLength:1},payload_json:{type:"string",minLength:2},
    record_key:NULLABLE_STRING,expected_version:{type:["integer","null"],minimum:0},
    fields:{type:"array",items:{type:"string"},uniqueItems:true},logical_k1:NULLABLE_STRING,
  },
  required:["dataset_id","instance_id","logical_output_id","payload_json","record_key","expected_version","fields","logical_k1"],
};
const MARKET_QUOTE_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{query:{type:"string",minLength:1},symbol:NULLABLE_STRING,as_of:NULLABLE_STRING},
  required:["query","symbol","as_of"],
};
const SOURCE_VERIFY_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{query:{type:"string",minLength:1},source_url:NULLABLE_STRING},
  required:["query","source_url"],
};
const TOOL_SCHEMAS:Record<string,Record<string,unknown>>={
  workos_read:WORKOS_READ_SCHEMA,workos_write:WORKOS_WRITE_SCHEMA,
  market_quote:MARKET_QUOTE_SCHEMA,source_verify:SOURCE_VERIFY_SCHEMA,
};

export function modelToolsForContext(context:ExecutionContextId):any[]{
  const c=capabilitiesFor(context);const t:any[]=[];
  if(c.has("web_search")) t.push({type:"web_search"});
  for(const n of ["workos_read","workos_write","market_quote","source_verify"] as CapabilityName[]){
    if(c.has(n)) t.push({type:"function",name:n,strict:true,parameters:TOOL_SCHEMAS[n]});
  }
  return t;
}
async function callTool(context:ExecutionContextId, call:any, h:ModelToolHandlers){const m:any={workos_read:["workos_read",h.workosRead],workos_write:["workos_write",h.workosWrite],market_quote:["market_quote",h.marketQuote],source_verify:["source_verify",h.sourceVerify]};const e=m[call.name];if(!e)throw new Error(`MODEL_TOOL_UNKNOWN:${call.name}`);assertCapability(context,e[0]);let a={};try{a=JSON.parse(call.arguments??"{}")}catch{throw new Error("MODEL_TOOL_ARGUMENTS_INVALID")};return e[1](a);}
const WF_SCHEMA={type:"object",additionalProperties:false,properties:{kind:{type:"string",enum:["DISPATCH_ROLE","STOP","BLOCKED"]},role:{type:["string","null"]},payload_json:{type:"string"},reason:{type:["string","null"]}},required:["kind","role","payload_json","reason"]};
const ROLE_SCHEMA={type:"object",additionalProperties:false,properties:{kind:{type:"string",enum:["ROLE_RESULT"]},status:{type:"string",enum:["COMPLETED","PARTIAL","FAILED","BLOCKED"]},return_target:{type:"string",enum:["WORKFLOW"]},payload_json:{type:"string"},reason:{type:["string","null"]}},required:["kind","status","return_target","payload_json","reason"]};
export async function runStructuredModelContext(client:ResponsesClient, q:ModelContextRequest, h:ModelToolHandlers):Promise<WorkflowStep|RoleResult>{
  let input:any=["Execute only the registered WorkOS contract. Do not invent identities or transitions.",`Task_ID: ${q.taskId}`,`Caller_Identity: ${q.callerIdentity}`,q.instructionText,q.runtimeProfileText,JSON.stringify(q.input)].join("\n\n"), prev:string|undefined;
  for(let n=0;n<12;n++){const r=await client.responses.create({model:MODEL,input,...(prev?{previous_response_id:prev}:{}),tools:modelToolsForContext(q.context),parallel_tool_calls:false,text:{format:{type:"json_schema",name:q.kind==="WORKFLOW"?"workos_workflow_step":"workos_role_result",strict:true,schema:q.kind==="WORKFLOW"?WF_SCHEMA:ROLE_SCHEMA}}});const calls=(r.output??[]).filter((i:any)=>i?.type==="function_call");if(!calls.length)return parseResult(q.kind,txt(r));const outs=[];for(const c of calls)outs.push({type:"function_call_output",call_id:String(c.call_id),output:JSON.stringify(await callTool(q.context,c,h))});prev=String(r.id??"");if(!prev)throw new Error("MODEL_RESPONSE_ID_MISSING");input=outs;}throw new Error("MODEL_CONTEXT_STEP_LIMIT");
}
export async function runBoundedWebLookup(client:ResponsesClient,input:{purpose:"MARKET_QUOTE"|"SOURCE_VERIFY";query:Record<string,unknown>}){const r=await client.responses.create({model:MODEL,tools:[{type:"web_search"}],input:`Bounded ${input.purpose}: ${JSON.stringify(input.query)}`});return{status:"SUCCESS" as const,text:txt(r)}}
