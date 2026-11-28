// Candidate read-side binding for the incumbent D1 Worker. No mutation endpoint.
import { readAuthorityGeneration, type AuthorityDB, type AuthorityTuple } from "./authority_boundary_candidate.js";

export const AUTHORITY_READ_PATH = "/candidate/authority-publication";
export const AUTHORITY_READ_URL = "https://d1-runtime-prototype.lennyliu01.workers.dev" + AUTHORITY_READ_PATH;
export const AUTHORITY_COLUMNS = ["Authority_Scope_Fingerprint","Current_Committed_Cutover_ID","Current_Activation_Epoch","Registry_Snapshot_ID","Manifest_Set_ID","Gate_Config_Fingerprint","Workflow_Set_Fingerprint","Published_At"] as const;
const CUTOVER_FIELDS = ["Cutover_ID","Authority_Scope_Fingerprint","Activation_Epoch","Target_Registry_File_ID","Target_Registry_Snapshot_ID","Target_Registry_Fingerprint","Target_Archive_Schema_Catalog_File_ID","Target_Archive_Schema_Catalog_Fingerprint","Target_Manifest_Set_ID","Target_Manifest_Set_Fingerprint","Target_Workflow_Set_Fingerprint","Candidate_Workflow_File_IDs","Persistent_Data_Gate_Config_Fingerprint","Target_Acceptance_Binding_ID","Preparation_Anchor_ID","Final_Activation_Approval_ID","Migration_Execution_Manifest_ID","AGENTS_Target_Revision","Predecessor_Committed_Cutover_ID"] as const;
const MEMBER_FIELDS = ["Manifest_Set_ID","Task_ID","Manifest_File_ID","Manifest_Fingerprint","Projection_State"] as const;
type Row = Record<string,string>;
export interface AuthorityGeneration { tuple: AuthorityTuple; dependenciesJson: string }
function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AUTHORITY_GENERATION_INVALID");
  return value as Record<string,unknown>;
}
function project(value: unknown, keys: readonly string[], exact = false): Row {
  const row=object(value);
  if(exact && Object.keys(row).length!==keys.length)throw new Error("AUTHORITY_COMPANION_FIELDS_INVALID");
  return Object.fromEntries(keys.map(k=>{
    const v=row[k];if(typeof v!=="string"||!v.trim())throw new Error("AUTHORITY_COMPANION_FIELD_MISSING:"+k);
    return [k,v];
  }));
}
function workflows(cutover: Row): Map<string,string> {
  const map=new Map<string,string>();
  for(const item of cutover.Candidate_Workflow_File_IDs.split(";")){
    const pair=item.split("=");
    if(pair.length!==2||!pair[0]||!pair[1]||map.has(pair[0]))throw new Error("AUTHORITY_WORKFLOW_MAPPING_INVALID");
    map.set(pair[0],pair[1]);
  }
  return map;
}
function normalizedMembers(values: unknown, setId:string): Row[] {
  if(!Array.isArray(values)||!values.length)throw new Error("AUTHORITY_MEMBERS_MISSING");
  const members=values.map(v=>project(v,MEMBER_FIELDS,true));
  const ids=new Set<string>();
  for(const m of members){
    if(m.Manifest_Set_ID!==setId||m.Projection_State!=="ACTIVE"||ids.has(m.Task_ID))throw new Error("AUTHORITY_MEMBER_CONFLICT");
    ids.add(m.Task_ID);
  }
  return members.sort((a,b)=>a.Task_ID<b.Task_ID?-1:a.Task_ID>b.Task_ID?1:0);
}
function decodeDependencies(g: AuthorityGeneration): {cutover:Row; manifestMembers:Row[]} {
  const d=object(JSON.parse(g.dependenciesJson));
  if(Object.keys(d).length!==2)throw new Error("AUTHORITY_COMPANION_FIELDS_INVALID");
  const c=project(d.cutover,CUTOVER_FIELDS,true), t=g.tuple;
  const pairs: [string,string][]=[
    ["Authority_Scope_Fingerprint",t[0]],["Cutover_ID",t[1]],["Activation_Epoch",String(t[2])],
    ["Target_Registry_Snapshot_ID",t[3]],["Target_Manifest_Set_ID",t[4]],
    ["Persistent_Data_Gate_Config_Fingerprint",t[5]],["Target_Workflow_Set_Fingerprint",t[6]]
  ];
  if(pairs.some(([k,v])=>c[k]!==v))throw new Error("AUTHORITY_TUPLE_COMPANION_MISMATCH");
  const manifestMembers=normalizedMembers(d.manifestMembers,t[4]);
  const w=workflows(c);
  if(w.size!==manifestMembers.length||manifestMembers.some(m=>!w.has(m.Task_ID)))throw new Error("AUTHORITY_WORKFLOW_MEMBER_MISMATCH");
  return {cutover:c,manifestMembers};
}
export function parseAuthorityGeneration(value:unknown): AuthorityGeneration {
  const row=object(value), t=row.tuple;
  if(Object.keys(row).length!==2||!Array.isArray(t)||t.length!==8||
     !t.every((v,i)=>i===2?typeof v==="number"&&Number.isSafeInteger(v)&&v>=0:typeof v==="string"&&v.trim().length>0)||
     typeof row.dependenciesJson!=="string")throw new Error("AUTHORITY_TUPLE_INVALID");
  const g={tuple:t as unknown as AuthorityTuple,dependenciesJson:row.dependenciesJson};
  decodeDependencies(g);
  return g;
}
export function generationRows(g:AuthorityGeneration):string[][] {
  const checked=parseAuthorityGeneration(g);
  return [[...AUTHORITY_COLUMNS],checked.tuple.map(String)];
}
export function verifyAuthorityCompanions(g:AuthorityGeneration,cutovers:Row[],members:Row[],taskId:string,workflowId:string):void {
  const expected=decodeDependencies(parseAuthorityGeneration(g));
  const matching=cutovers.filter(c=>c.Cutover_ID===g.tuple[1]);
  if(matching.length!==1)throw new Error("AUTHORITY_CUTOVER_NOT_UNIQUE");
  if(!["AUTHORITY_COMMITTED","ROUTING_RELEASED","COMPLETE"].includes(matching[0].Cutover_State))throw new Error("AUTHORITY_CUTOVER_NOT_COMMITTED");
  const observed=project(matching[0],CUTOVER_FIELDS);
  if(JSON.stringify(observed)!==JSON.stringify(expected.cutover))throw new Error("AUTHORITY_CUTOVER_COMPANION_DRIFT");
  const actual=normalizedMembers(members.filter(m=>m.Manifest_Set_ID===g.tuple[4]).map(m=>project(m,MEMBER_FIELDS)),g.tuple[4]);
  if(JSON.stringify(actual)!==JSON.stringify(expected.manifestMembers))throw new Error("AUTHORITY_MANIFEST_COMPANION_DRIFT");
  if(workflows(observed).get(taskId)!==workflowId)throw new Error("AUTHORITY_WORKFLOW_COMPANION_DRIFT");
}
export function sameGeneration(a:AuthorityGeneration,b:AuthorityGeneration):boolean {
  return JSON.stringify(a.tuple)===JSON.stringify(b.tuple)&&a.dependenciesJson===b.dependenciesJson;
}
export async function fetchAuthorityGeneration(secret:string|undefined,f:typeof fetch=fetch):Promise<AuthorityGeneration> {
  if(!secret)throw new Error("D1_AUTHORITY_READER_CREDENTIAL_UNBOUND");
  const r=await f(AUTHORITY_READ_URL,{method:"GET",headers:{Authorization:"Bearer "+secret,"Cache-Control":"no-store"},redirect:"error",cache:"no-store"});
  if(!r.ok)throw new Error("D1_AUTHORITY_READ_FAILED:"+r.status);
  return parseAuthorityGeneration(await r.json());
}
export async function handleAuthorityRead(request:Request,env:{DB:unknown;RUNTIME_SECRET?:string;AUTHORITY_READER_SECRET?:string}):Promise<Response>{
  const response=(body:unknown,status:number)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});
  const url=new URL(request.url);
  if(request.method!=="GET"||url.pathname!==AUTHORITY_READ_PATH||url.search)return response({error:"AUTHORITY_OPERATION_DENIED"},405);
  const secret=env.AUTHORITY_READER_SECRET;
  if(!secret||!env.RUNTIME_SECRET||secret===env.RUNTIME_SECRET)return response({error:"AUTHORITY_READER_UNBOUND"},503);
  if(request.headers.get("Authorization")!=="Bearer "+secret)return response({error:"UNAUTHORIZED"},401);
  const db=env.DB as Partial<AuthorityDB>|undefined;
  if(!db||typeof db.withSession!=="function")return response({error:"AUTHORITY_PRIMARY_UNAVAILABLE"},503);
  try{
    return response(parseAuthorityGeneration(await readAuthorityGeneration(db as AuthorityDB)),200);
  }catch{
    return response({error:"AUTHORITY_GENERATION_UNAVAILABLE"},503);
  }
}
