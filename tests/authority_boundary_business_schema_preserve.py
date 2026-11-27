"""Local existing migration 0003 preimage preservation, not live business permission testing."""
import json
import pathlib
import sqlite3
import time

with sqlite3.connect(':memory:') as db:
    db.executescript(pathlib.Path('migrations/0003_create_workos_candidate_persistence.sql').read_text())
    db.execute('INSERT INTO workos_append_records VALUES (1,?,?,?,?,?,?,?)', ('fixture-dataset','fixture-instance','fixture-key','{}','inv-1','idem-1','fixture-time'))
    db.execute('INSERT INTO workos_current_state_versions VALUES (?,?,?,?,?,?,?,?)', ('fixture-current','fixture-instance',1,0,'{}','inv-2','idem-2','fixture-time'))
    def snapshot():
        return (db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name LIKE 'workos_%' OR tbl_name LIKE 'workos_%' OR name='idx_workos_append_stream' ORDER BY name").fetchall(),db.execute('SELECT * FROM workos_append_records').fetchall(),db.execute('SELECT * FROM workos_current_state_versions').fetchall())
    before=snapshot()
    db.executescript(pathlib.Path('migrations/0004_candidate_authority_publication_boundary.sql').read_text())
    assert snapshot()==before
    tuple10=json.dumps(['scope','cut10',10,'rs10','ms10','gate10','wf10','time10'],separators=(',',':'))
    tuple11=json.dumps(['scope','cut11',11,'rs11','ms11','gate11','wf11','time11'],separators=(',',':'))
    dep='{"fixture":true}'
    db.execute('INSERT INTO authority_boundary_seed VALUES (1,?,?)',(tuple10,dep))
    db.execute('INSERT INTO authority_boundary_grant VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('grant','request','publisher','session','revoker',tuple10,tuple11,dep,dep,dep,'spec','pcv','faa2',int(time.time())+3600))
    envelope=db.execute('SELECT envelope FROM authority_boundary_grant_envelope').fetchone()[0]
    db.execute('INSERT INTO authority_boundary_started VALUES (?,?,?,?,?,?)',('request','grant',envelope,'publisher','session',dep))
    db.execute('INSERT INTO authority_boundary_terminal (request_id,grant_id,envelope,outcome,epoch,actor,session_id,frozen_identity) VALUES (?,?,?,?,?,?,?,?)',('request','grant',envelope,'COMMITTED',11,'publisher','session',dep))
    assert snapshot()==before
    assert db.execute('SELECT epoch FROM authority_boundary_current').fetchone()[0]==11
    print('PASS existing migration 0003 tables, indexes and fixture rows unchanged after migration and publication')
