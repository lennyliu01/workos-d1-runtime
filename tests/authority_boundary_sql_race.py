"""SQLite separate-connection competition; not a D1 Provider witness."""
import concurrent.futures
import json
import pathlib
import sqlite3
import tempfile
import threading
import time

schema = pathlib.Path('migrations/0004_candidate_authority_publication_boundary.sql').read_text()
e10 = ['fixture-scope','cut-10',10,'rs10','ms10','gate10','wf10','t10']
e11 = ['fixture-scope','cut-11',11,'rs11','ms11','gate11','wf11','t11']
deps10 = '{"registry":"fixture-10"}'
deps11 = '{"registry":"fixture-11"}'
frozen = '{"frozen":"fixture"}'
compact = lambda obj: json.dumps(obj, separators=(',',':'))
claim = 'INSERT INTO authority_boundary_started VALUES (?,?,?,?,?,?)'
terminal = 'INSERT INTO authority_boundary_terminal (request_id,grant_id,envelope,outcome,epoch,actor,session_id,frozen_identity) VALUES (?,?,?,?,?,?,?,?)'

def grant(db, name):
    g, r, s = 'g'+name, 'r'+name, 's'+name
    db.execute('INSERT INTO authority_boundary_grant VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (g,r,'publisher',s,'revoker',compact(e10),compact(e11),deps10,deps11,frozen,'change','pcv','faa2',int(time.time())+3600))
    envelope = db.execute('SELECT envelope FROM authority_boundary_grant_envelope WHERE grant_id=?',(g,)).fetchone()[0]
    db.execute(claim, (r,g,envelope,'publisher',s,frozen))
    return (r,g,envelope,s)

def args(g, outcome):
    r, gid, env, s = g
    return (r,gid,env,outcome,11 if outcome=='COMMITTED' else None,'publisher' if outcome=='COMMITTED' else 'revoker',s,frozen)

def race(path, entries):
    barrier=threading.Barrier(2)
    def invoke(entry):
        with sqlite3.connect(path, timeout=10, isolation_level=None) as db:
            barrier.wait(timeout=5)
            try:
                db.execute(terminal, entry)
                return 'INSERTED'
            except sqlite3.IntegrityError:
                return 'DENIED'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        return list(pool.map(invoke, entries))

for mode in ['two-publishers','commit-vs-revoke']:
    for i in range(20):
        with tempfile.TemporaryDirectory() as td:
            path=str(pathlib.Path(td)/'race.sqlite3')
            with sqlite3.connect(path, isolation_level=None) as db:
                db.executescript(schema)
                db.execute('INSERT INTO authority_boundary_seed VALUES (1,?,?)',(compact(e10),deps10))
                g=grant(db,'a')
                entries=[args(g,'COMMITTED'),args(grant(db,'b'),'COMMITTED')] if mode=='two-publishers' else [args(g,'COMMITTED'),args(g,'CANCELED')]
                assert sorted(race(path,entries))==['DENIED','INSERTED']
                assert db.execute('SELECT count(*) FROM authority_boundary_terminal').fetchone()[0]==1
                outcome=db.execute('SELECT outcome FROM authority_boundary_terminal').fetchone()[0]
                assert db.execute('SELECT epoch FROM authority_boundary_current').fetchone()[0]==(11 if outcome=='COMMITTED' else 10)
                if mode=='commit-vs-revoke':
                    for entry in entries:
                        try:
                            db.execute(terminal,entry)
                        except sqlite3.IntegrityError:
                            pass
                        else:
                            raise AssertionError('late duplicate accepted')
                if mode=='two-publishers':
                    for entry in entries:
                        try:
                            db.execute(terminal,entry)
                        except sqlite3.IntegrityError:
                            pass
                        else:
                            raise AssertionError('late predecessor accepted')
    print(f'PASS {mode}: 20 separate-connection races, one terminal winner each')
