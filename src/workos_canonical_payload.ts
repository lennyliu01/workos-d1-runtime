/** Shared canonical D1 payload serialization and Grant SHA-256 identity. */
export function canonicalizeWorkOsPayload(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonicalizeWorkOsPayload);
  if(value!==null && typeof value==="object") {
    const record=value as Record<string,unknown>;
    const canonical:Record<string,unknown>={};
    for(const key of Object.keys(record).sort())canonical[key]=canonicalizeWorkOsPayload(record[key]);
    return canonical;
  }
  return value;
}
export function serializeWorkOsPayload(payload:unknown):string|null{
  if(payload===undefined)return null;
  try{
    const result=JSON.stringify(canonicalizeWorkOsPayload(payload));
    return result===undefined?null:result;
  }catch{return null;}
}
export async function sha256PayloadHex(payloadJson:string):Promise<string>{
  const hash=new Uint8Array(await crypto.subtle.digest(
    "SHA-256",new TextEncoder().encode(payloadJson)));
  return Array.from(hash,x=>x.toString(16).padStart(2,"0")).join("");
}
