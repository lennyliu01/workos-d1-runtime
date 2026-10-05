import type { ExactControlPlaneReader, SupportedTaskId } from "./workos_control_plane_loader.js";
import type { ManifestAccessRow } from "./workos_persistent_gate_projection.js";

const ACCEPTANCE_COMPONENT = "D1_PROVIDER_INVOCATION_CONTRACT";
const D1_CASES = [
  "D1_APPEND_WRITE_SAFETY",
  "D1_CURRENT_STATE_CAS",
  "D1_BOUNDED_READ",
  "ACTIVATION_TIME_D1_CAPABILITY_RECONFIRMATION",
] as const;

interface LiveContextInput {
  taskId: SupportedTaskId;
  currentCutoverId: string;
  currentRegistryFileId: string;
  currentRegistrySnapshotId: string;
  currentRegistryFingerprint: string;
  currentAcceptanceBindingId: string;
  accesses: readonly ManifestAccessRow[];
}

export interface LiveGateContext {
  migrationFenceActive: boolean;
  pruneFenceIndexAvailable: boolean;
  pruneFencedKeys: ReadonlySet<string>;
  startedPruneKeys: ReadonlySet<string>;
  archivedIdentityKeys: ReadonlySet<string>;
  physicalContractFingerprints: ReadonlyMap<string,string>;
  businessAuthorityStates: ReadonlyMap<string,string>;
  sourceEvidence: Readonly<Record<string,string>>;
}

type Row=Record<string,string>;
const lk=(d:string,k:string)=>`${d}\u0000${k}`;
const ik=(d:string,i:string)=>`${d}\u0000${i}`;

function rows(values:string[][], required:readonly string[], label:string):Row[]{
  if(!values.length) throw new Error(`LIVE_GATE_CONTEXT_UNAVAILABLE:${label}:EMPTY`);
  const h=values[0]??[];
  for(const c of required) if(!h.includes(c)) throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:MISSING_COLUMN:${c}`);
  return values.slice(1).filter(r=>r.some(v=>v!=="")).map(r=>Object.fromEntries(h.map((x,i)=>[x,r[i]??""])));
}
function one<T>(xs:readonly T[], label:string):T{
  if(xs.length!==1) throw new Error(`LIVE_GATE_CONTEXT_AMBIGUOUS:${label}:${xs.length}`);
  return xs[0];
}
function resource(rs:readonly Row[], dataset:string, member?:string):Row{
  const r=one(rs.filter(x=>x.Dataset_ID===dataset),`RESOURCE:${dataset}`);
  if(!r.Exact_File_ID||!r.Projection_Fingerprint) throw new Error(`LIVE_GATE_CONTEXT_INVALID:RESOURCE:${dataset}`);
  if(member&&r.Exact_Member_Name!==member) throw new Error(`LIVE_GATE_CONTEXT_INVALID:RESOURCE_MEMBER:${dataset}`);
  return r;
}
function bool(v:string,label:string):boolean{
  if(v==="TRUE") return true;if(v==="FALSE") return false;
  throw new Error(`LIVE_GATE_CONTEXT_INVALID:${label}:${v}`);
}
function field(block:string,label:string):string{
  const prefix=`- ${label}: `;
  const matches=block.split("\n").filter(line=>line.startsWith(prefix));
  if(matches.length!==1) throw new Error(`LIVE_GATE_CONTEXT_AMBIGUOUS:BUSINESS_AUTHORITY_FIELD:${label}:${matches.length}`);
  const raw=matches[0].slice(prefix.length).trim();
  const value=raw.startsWith("`")&&raw.endsWith("`")?raw.slice(1,-1):raw;
  if(!value) throw new Error(`LIVE_GATE_CONTEXT_INVALID:BUSINESS_AUTHORITY_FIELD:${label}`);
  return value;
}
function companyState(text:string,id:string):string{
  const lines=text.split("\n"), marker=`## ${id}`;
  const positions=lines.map((line,index)=>line===marker?index:-1).filter(index=>index>=0);
  if(positions.length!==1) throw new Error(`LIVE_GATE_CONTEXT_AMBIGUOUS:COMPANY_AUTHORITY:${id}:${positions.length}`);
  const start=positions[0];
  let end=lines.length;
  for(let i=start+1;i<lines.length;i++){if(lines[i].startsWith("## ")){end=i;break;}}
  const block=lines.slice(start,end).join("\n");
  const monitor=bool(field(block,"Monitor_Enabled"),`MONITOR_ENABLED:${id}`);
  const archived=bool(field(block,"Archived"),`ARCHIVED:${id}`);
  const state=field(block,"State_Status");
  if(archived){
    if(monitor||state!=="ARCHIVED") throw new Error(`LIVE_GATE_CONTEXT_INVALID:BUSINESS_AUTHORITY_INCONSISTENT:${id}`);
    return "ARCHIVED";
  }
  if(state==="ACTIVE"&&monitor) return "ACTIVE";
  return state==="ACTIVE"?"DISABLED":state;
}
export async function loadLiveGateContext(reader:ExactControlPlaneReader,input:LiveContextInput):Promise<LiveGateContext>{
  const [metaV,resV,contractsV,datasetContractsV]=await Promise.all([
    reader.readSheet(input.currentRegistryFileId,"Registry_Metadata","A1:K5"),
    reader.readSheet(input.currentRegistryFileId,"Resource_Projection","A1:J500"),
    reader.readSheet(input.currentRegistryFileId,"Contract_Fingerprints","A1:E500"),
    reader.readSheet(input.currentRegistryFileId,"Dataset_Contracts","A1:I500"),
  ]);
  const meta=one(rows(metaV,["Registry_State","Active_Registry_Snapshot_ID","Active_Registry_Fingerprint"],"REGISTRY_METADATA"),"REGISTRY_METADATA");
  if(meta.Registry_State!=="ACTIVE"||meta.Active_Registry_Snapshot_ID!==input.currentRegistrySnapshotId||meta.Active_Registry_Fingerprint!==input.currentRegistryFingerprint)
    throw new Error("LIVE_GATE_CONTEXT_STALE:REGISTRY_METADATA");
  const rs=rows(resV,["Dataset_ID","Instance_Projection_Mode","Exact_File_ID","Exact_Member_Name","Parent_Instance_Registry_ID","Projection_Fingerprint"],"RESOURCE_PROJECTION");
  const cs=rows(contractsV,["Registry_Snapshot_ID","Dataset_ID","Registry_Contract_Fingerprint","Registry_Snapshot_Fingerprint"],"CONTRACT_FINGERPRINTS");
  const dcs=rows(datasetContractsV,["Dataset_ID","Contract_Status","Registry_Contract_Fingerprint"],"DATASET_CONTRACTS");

  const physical=new Map<string,string>();
  for(const a of input.accesses){
    const c=one(cs.filter(x=>x.Dataset_ID===a.datasetId&&x.Registry_Snapshot_ID===input.currentRegistrySnapshotId&&x.Registry_Snapshot_Fingerprint===input.currentRegistryFingerprint),`CONTRACT:${a.datasetId}`);
    const dc=one(dcs.filter(x=>x.Dataset_ID===a.datasetId),`DATASET_CONTRACT:${a.datasetId}`);
    if(dc.Contract_Status!=="ACTIVE"||dc.Registry_Contract_Fingerprint!==c.Registry_Contract_Fingerprint||!c.Registry_Contract_Fingerprint)
      throw new Error(`LIVE_GATE_CONTEXT_STALE:CONTRACT:${a.datasetId}`);
    if(a.contractFingerprint!==c.Registry_Contract_Fingerprint)
      throw new Error(`LIVE_GATE_CONTEXT_STALE:MANIFEST_PHYSICAL_CONTRACT:${a.datasetId}`);
    const rr=one(rs.filter(x=>x.Dataset_ID===a.datasetId),`PHYSICAL_RESOURCE:${a.datasetId}`);
    if(!rr.Projection_Fingerprint) throw new Error(`LIVE_GATE_CONTEXT_INVALID:PHYSICAL_RESOURCE:${a.datasetId}`);
    if(a.dynamicInstance){
      if(rr.Instance_Projection_Mode!=="D1_REGISTERED_PARENT"||rr.Parent_Instance_Registry_ID!=="RW_COMPANY_REGISTRY")
        throw new Error(`LIVE_GATE_CONTEXT_STALE:DYNAMIC_RESOURCE:${a.datasetId}`);
    }else if(a.datasetId!=="RW_COMPANY_REGISTRY"&&rr.Instance_Projection_Mode!=="D1_SINGLETON"){
      throw new Error(`LIVE_GATE_CONTEXT_STALE:SINGLETON_RESOURCE:${a.datasetId}`);
    }
    physical.set(a.datasetId,c.Registry_Contract_Fingerprint);
  }

  // The current Registry contract fingerprint is accepted as the physical D1 contract only
  // when the current Acceptance Binding still proves the accepted D1 provider lineage.
  const acceptR=resource(rs,"SYS_ARCHIVE_ACCEPTANCE_RESULT","Acceptance_Results");
  const runtimeR=resource(rs,"SYS_RUNTIME_COMPONENT_PROJECTION","Runtime_Component_Projection");
  if(acceptR.Exact_File_ID!==runtimeR.Exact_File_ID) throw new Error("LIVE_GATE_CONTEXT_INVALID:ACCEPTANCE_CONTROL_SPLIT");
  const [projV,accV]=await Promise.all([
    reader.readSheet(runtimeR.Exact_File_ID,"Runtime_Component_Projection","A1:F300"),
    reader.readSheet(acceptR.Exact_File_ID,"Acceptance_Results","A1:M500"),
  ]);
  const proj=rows(projV,["Acceptance_Binding_ID","Component_ID","Projection_State"],"RUNTIME_COMPONENT_PROJECTION");
  one(proj.filter(x=>x.Acceptance_Binding_ID===input.currentAcceptanceBindingId&&x.Component_ID===ACCEPTANCE_COMPONENT&&x.Projection_State==="ACTIVE"),"ACTIVE_D1_PROVIDER_CONTRACT");
  const acc=rows(accV,["Acceptance_Binding_ID","Test_Case_ID","Registry_Snapshot_ID","Result"],"ACCEPTANCE_RESULTS");
  for(const tc of D1_CASES) one(acc.filter(x=>x.Acceptance_Binding_ID===input.currentAcceptanceBindingId&&x.Registry_Snapshot_ID===input.currentRegistrySnapshotId&&x.Test_Case_ID===tc&&x.Result==="PASS"),`D1_ACCEPTANCE:${tc}`);

  const migR=resource(rs,"SYS_MIGRATION_WRITE_FENCE","MIGRATION_WRITE_FENCE");
  const mig=rows(await reader.readSheet(migR.Exact_File_ID,"MIGRATION_WRITE_FENCE","A1:J1000"),["Fence_ID","Dataset_ID","Fence_State","Cutover_ID"],"MIGRATION_WRITE_FENCE");
  let migrationFenceActive=false;
  for(const d of new Set(input.accesses.filter(a=>a.writerScopes.length).map(a=>a.datasetId))){
    const m=one(mig.filter(x=>x.Dataset_ID===d&&x.Cutover_ID===input.currentCutoverId),`MIGRATION_FENCE:${d}`);
    if(!["ACTIVE","RELEASED"].includes(m.Fence_State)) throw new Error(`LIVE_GATE_CONTEXT_INVALID:MIGRATION_FENCE_STATE:${m.Fence_State}`);
    if(m.Fence_State!=="RELEASED") migrationFenceActive=true;
  }

  const pruneR=resource(rs,"SYS_ARCHIVE_PRUNE_FENCE_INDEX","Archive_Prune_Fence_Index");
  const pruneValues=await reader.readSheet(pruneR.Exact_File_ID,"Archive_Prune_Fence_Index","A1:K1000");
  const prune=rows(pruneValues,
    ["Archive_Unit_ID","Archive_Transaction_ID","Fence_State","Registry_Contract_Fingerprint","Exact_Member_Set_Fingerprint","Exact_K1_Set","Blocked_Dependency_Write_Scope","Affected_Source_Instances","Created_At","Started_At"],"ARCHIVE_PRUNE_FENCE_INDEX");
  const pruneFenceIndexAvailable=pruneValues.length>=1;
  if(!pruneFenceIndexAvailable) throw new Error("LIVE_GATE_CONTEXT_UNAVAILABLE:ARCHIVE_PRUNE_FENCE_INDEX");
  const fenced=new Set<string>(),started=new Set<string>();
  if(prune.length){
    const txR=resource(rs,"SYS_ARCHIVE_TRANSACTION_REGISTRY","Archive_Transaction_Registry");
    const memR=resource(rs,"SYS_ARCHIVE_TRANSACTION_MEMBERS","Archive_Transaction_Members");
    if(txR.Exact_File_ID!==memR.Exact_File_ID) throw new Error("LIVE_GATE_CONTEXT_INVALID:ARCHIVE_CONTROL_SPLIT");
    const [txV,memV]=await Promise.all([
      reader.readSheet(txR.Exact_File_ID,"Archive_Transaction_Registry","A1:T1000"),
      reader.readSheet(memR.Exact_File_ID,"Archive_Transaction_Members","A1:N1000"),
    ]);
    const tx=rows(txV,["Archive_Transaction_ID","Dataset_ID","Transaction_State","Registry_Contract_Fingerprint","Active_Fence_State"],"ARCHIVE_TRANSACTION_REGISTRY");
    const mem=rows(memV,["Archive_Transaction_ID","Dataset_ID","Record_Key_Canonical","Member_State"],"ARCHIVE_TRANSACTION_MEMBERS");
    for(const f of prune){
      if(!["PREPARED","STARTED"].includes(f.Fence_State)||!f.Exact_K1_Set||!f.Exact_Member_Set_Fingerprint||!f.Registry_Contract_Fingerprint)
        throw new Error(`LIVE_GATE_CONTEXT_INVALID:PRUNE_FENCE:${f.Archive_Unit_ID}`);
      const t=one(tx.filter(x=>x.Archive_Transaction_ID===f.Archive_Transaction_ID),`PRUNE_TRANSACTION:${f.Archive_Transaction_ID}`);
      if(t.Registry_Contract_Fingerprint!==f.Registry_Contract_Fingerprint||t.Active_Fence_State!==f.Fence_State)
        throw new Error(`LIVE_GATE_CONTEXT_STALE:PRUNE_TRANSACTION:${f.Archive_Transaction_ID}`);
      const ms=mem.filter(x=>x.Archive_Transaction_ID===f.Archive_Transaction_ID);
      if(!ms.length) throw new Error(`LIVE_GATE_CONTEXT_UNAVAILABLE:PRUNE_MEMBERS:${f.Archive_Transaction_ID}`);
      for(const m of ms){
        if(!m.Dataset_ID||!m.Record_Key_Canonical) throw new Error(`LIVE_GATE_CONTEXT_INVALID:PRUNE_MEMBER:${f.Archive_Transaction_ID}`);
        const k=lk(m.Dataset_ID,m.Record_Key_Canonical);
        fenced.add(k);
        if(f.Fence_State==="STARTED") started.add(k);
      }
    }
  }

  const routeR=resource(rs,"SYS_ARCHIVE_INDEX_ROUTE_DIRECTORY");
  const [idxV,routesV]=await Promise.all([
    reader.readSheet(routeR.Exact_File_ID,"Index_Metadata","A1:I5"),
    reader.readSheet(routeR.Exact_File_ID,"Shard_Routes","A1:J100"),
  ]);
  const idx=one(rows(idxV,["Index_ID","Index_State","Index_Version","Routing_Version","Active_Routing_Fingerprint"],"ARCHIVE_INDEX_METADATA"),"ARCHIVE_INDEX_METADATA");
  if(idx.Index_ID!=="ARCHIVE_LOCATOR_INDEX"||idx.Index_State!=="ACTIVE"||idx.Routing_Version!=="ROUTE_V1"||!idx.Index_Version||!idx.Active_Routing_Fingerprint)
    throw new Error("LIVE_GATE_CONTEXT_STALE:ARCHIVE_LOCATOR_INDEX");
  const routes=rows(routesV,["Logical_Table","Bucket_Start","Bucket_End","Shard_File_ID","Shard_Tab_Name","Route_State","Routing_Fingerprint"],"ARCHIVE_SHARD_ROUTES");
  const rr=one(routes.filter(x=>x.Logical_Table==="Record_Locators"&&x.Route_State==="ACTIVE"),"RECORD_LOCATOR_ROUTE");
  if(rr.Bucket_Start!=="00"||rr.Bucket_End!=="ff"||rr.Shard_Tab_Name!=="Record_Locators"||!rr.Shard_File_ID||!rr.Routing_Fingerprint)
    throw new Error("LIVE_GATE_CONTEXT_INVALID:RECORD_LOCATOR_ROUTE");
  const loc=rows(await reader.readSheet(rr.Shard_File_ID,"Record_Locators","A1:Q1000"),
    ["Record_Locator_ID","Dataset_ID","Record_Key_Canonical","Registry_Contract_Fingerprint_At_Copy","Index_State","Active_Prune_Verified_At"],"RECORD_LOCATORS");
  const archived=new Set<string>();
  for(const x of loc){
    if(!["COPY_VERIFIED","ARCHIVED"].includes(x.Index_State)) throw new Error(`LIVE_GATE_CONTEXT_INVALID:LOCATOR_STATE:${x.Index_State}`);
    if(x.Index_State==="ARCHIVED"){
      const expected=physical.get(x.Dataset_ID);
      if(!x.Dataset_ID||!x.Record_Key_Canonical||!x.Active_Prune_Verified_At||!expected)
        throw new Error("LIVE_GATE_CONTEXT_INVALID:ARCHIVED_LOCATOR");
      if(x.Registry_Contract_Fingerprint_At_Copy!==expected) throw new Error(`LIVE_GATE_CONTEXT_STALE:ARCHIVED_CONTRACT:${x.Dataset_ID}`);
      archived.add(lk(x.Dataset_ID,x.Record_Key_Canonical));
    }
  }

  const business=new Map<string,string>();
  let baselineText:string|undefined;
  if(input.accesses.some(a=>a.dynamicInstance)){
    const b=resource(rs,"RW_COMPANY_REGISTRY","Companies_Baseline.md");
    baselineText=await reader.readDriveText(b.Exact_File_ID);
    if(!baselineText.includes("sole authority for `Monitor_Enabled`, `State_Status`, and `Archived`"))
      throw new Error("LIVE_GATE_CONTEXT_STALE:RW_COMPANY_REGISTRY_AUTHORITY");
  }
  for(const a of input.accesses){
    business.set(ik(a.datasetId,a.instanceId),a.dynamicInstance?companyState(baselineText!,a.instanceId):"NOT_APPLICABLE");
  }

  return {
    migrationFenceActive,
    pruneFenceIndexAvailable,
    pruneFencedKeys:fenced,
    startedPruneKeys:started,
    archivedIdentityKeys:archived,
    physicalContractFingerprints:physical,
    businessAuthorityStates:business,
    sourceEvidence:{
      registry:`${input.currentRegistryFileId}:${input.currentRegistrySnapshotId}:${input.currentRegistryFingerprint}`,
      physical:`${input.currentRegistryFileId}:Contract_Fingerprints:${input.currentAcceptanceBindingId}`,
      migration:`${migR.Exact_File_ID}:MIGRATION_WRITE_FENCE:${input.currentCutoverId}`,
      prune:`${pruneR.Exact_File_ID}:Archive_Prune_Fence_Index`,
      archiveIndex:`${routeR.Exact_File_ID}:${idx.Index_Version}:${rr.Shard_File_ID}`,
      businessAuthority:baselineText?"RW_COMPANY_REGISTRY:Companies_Baseline.md":"NOT_APPLICABLE",
    },
  };
}
