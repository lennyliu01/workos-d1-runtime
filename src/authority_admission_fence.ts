// Exact server-verified session/generation projection. No caller fields become SQL authority.
export interface AuthorityFence {sessionId:string;principal:string;tupleJson:string;dependenciesJson:string}
export const authorityFencePredicate="EXISTS (SELECT 1 FROM authority_boundary_admission_session s JOIN authority_boundary_current c ON c.tuple_json=s.tuple_json AND c.dependencies_json=s.dependencies_json WHERE s.session_id=? AND s.principal=? AND s.tuple_json=? AND s.dependencies_json=? AND s.state='OPEN' AND s.expires_unix>CAST(strftime('%s','now') AS INTEGER))";
export const authorityFenceValues=(f:AuthorityFence)=>[f.sessionId,f.principal,f.tupleJson,f.dependenciesJson];
