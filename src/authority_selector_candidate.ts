// Candidate adapter for the exact existing AGENTS root. Not a second selector.
// The D1 locator is proposed, not registered or accepted. No fallback.
export const LEGACY_AUTHORITY_LOCATOR='https://docs.google.com/spreadsheets/d/1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM/edit';
export const D1_AUTHORITY_LOCATOR='d1:b4e4ccf6-107b-4a8b-b679-0be7ef6bd48c/authority_boundary_current';
const PREFIX='- `Repository_Cutover_Control` / singleton `Authority_Publication` — `';
export type AuthorityRoute='SHEETS'|'D1';
export function authorityRoute(agents:string):AuthorityRoute {
  const lines=agents.split(/\r?\n/).filter(l=>l.startsWith(PREFIX));
  if(lines.length!==1)throw new Error('AUTHORITY_SELECTOR_NOT_UNIQUE');
  if(lines[0]===PREFIX+LEGACY_AUTHORITY_LOCATOR+'`')return 'SHEETS';
  if(lines[0]===PREFIX+D1_AUTHORITY_LOCATOR+'`')return 'D1';
  throw new Error('AUTHORITY_SELECTOR_UNRESOLVED');
}
export interface SelectedAuthorityReader {
  readSheet(id:string,sheet:string,range:string):Promise<string[][]>;
  // Required exact accepted transport and independently fenced consumers, not implemented.
  readD1AuthorityPublication?():Promise<string[][]>;
}
export async function selectedAuthorityRows(agents:string,reader:SelectedAuthorityReader):Promise<string[][]> {
  const route=authorityRoute(agents);
  if(route==='SHEETS')return reader.readSheet('1Ckqy598EPE9CO3gejn2b0sLC3IC1_FcwScRFPE2JumM','Authority_Publication','A1:H5');
  if(!reader.readD1AuthorityPublication)throw new Error('D1_AUTHORITY_TRANSPORT_UNBOUND');
  return reader.readD1AuthorityPublication();
}
