"""TEST ONLY: exact candidate Python Gate; isolated authority IDs, no network or real grant."""
import csv, json, sys
from pathlib import Path
from dataclasses import replace
from test_batch07_draft_gate import context, manifest, write, read, FIELDS
from data_archive_runtime.contracts import WriterScope
from data_archive_runtime.gate import authorize_write, authorize_read

root=Path(__file__).parent
def rows(name):
    with (root / name).open(newline='', encoding='utf-8-sig') as f:
        return list(csv.DictReader(f))

instances=rows("candidate_manifest_instance.csv")
writers=rows("candidate_manifest_write.csv")
readers=rows("candidate_manifest_read.csv")
baseline=(root/"Companies_Baseline.txt").read_text(encoding="utf-8-sig")
entries=[]
for inst in ("DSG","DOL","ENPLAS","SERVICENOW","FIGMA"):
    section=baseline.split("## "+inst+"\n")[1].split("\n## ")[0]
    state="DRAFT" if inst in ("DSG","DOL") else "ACTIVE"
    assert "State_Status: `"+state+"`" in section
    if state=="DRAFT": assert "Monitor_Enabled: `FALSE`" in section
    for dataset in (("RW_CURRENT_STATE","RW_EVIDENCE_HISTORY") if inst=="DSG" else ("RW_CURRENT_STATE",)):
        p=[x for x in instances if x["Dataset_ID"]==dataset and x["Exact_Resource_Resolution_Rule"].endswith("Instance_ID="+inst)]
        w=[x for x in writers if x["Dataset_ID"]==dataset and x["Instance_Rule"]=="REGISTERED_INSTANCE_BINDING:"+inst]
        r=[x for x in readers if x["Dataset_ID"]==dataset and x["Instance_Rule"]=="REGISTERED_INSTANCE_BINDING:"+inst]
        assert len(p)==len(w)==len(r)==1,(inst,dataset,p,w,r)
        w,r=w[0],r[0]
        assert w["Schema_Contract_Fingerprint"]==r["Schema_Contract_Fingerprint"]
        assert w["Exact_Member_Or_Resource_Class"]==r["Exact_Member_Or_Resource_Class"]
        proto=manifest().entries[0]
        entries.append(replace(proto, instance_id=inst,dataset_id=dataset,
            logical_member=w["Exact_Member_Or_Resource_Class"],
            contract_fingerprint=w["Schema_Contract_Fingerprint"],
            business_authority_state=state,
            write_mode="CURRENT_STATE" if dataset=="RW_CURRENT_STATE" else "APPEND_ONLY",
            writer_scopes=(WriterScope(w["Writer_Identity"],frozenset({w["Operation_Mode"]}),
                          FIELDS if dataset=="RW_CURRENT_STATE" else None),)))
# The candidate CSV is a delta on the old manifest; only the fixture manifest
# is ACTIVE, with DSG business authority DRAFT. No actual publication is implied.
m=replace(manifest(),entries=tuple(entries))
req=json.load(sys.stdin)
op=req["operation"]
dataset=req["dataset_id"]
common=dict(task_id=req["task_id"],dataset_id=dataset,instance_id=req["instance_id"],
            logical_member="D1_BOUND_DATASET:"+dataset+";Binding=DB")
ctx=context(expected_activation_epoch=req["epoch"],physical_contract_fingerprints={
    (e.dataset_id,e.instance_id,e.logical_member):e.contract_fingerprint for e in entries})
if op=="WRITE":
    decision=authorize_write(m,write(**common,writer_id=req["caller_identity"],
        operation="CONDITIONAL_CURRENT_STATE" if dataset=="RW_CURRENT_STATE" else "APPEND_ONLY",
        fields=frozenset(req.get("payload",{})),
        draft_initial_access="INITIAL_BASELINE_WRITE" if req.get("mode")=="INIT" else None),ctx)
else:
    decision=authorize_read(m,read(**common,reader_id=req["caller_identity"],
        draft_initial_access="INITIAL_BASELINE_READBACK" if req.get("mode")=="READBACK" else None),ctx)
print(json.dumps({"allowed":decision.allowed,"code":decision.code.value}))
