function incompatible(id) {
  return Object.assign(new Error('运行包补丁不兼容'), {status:422, patchId:id});
}
function exactReplace(source, {id,find,replace,count}) {
  if (typeof source !== 'string' || typeof id !== 'string' || !id || !Number.isSafeInteger(count) || count < 1 || (typeof find !== 'string' && !(find instanceof RegExp)) || find === '') throw incompatible(id);
  const pattern = typeof find === 'string' ? find : new RegExp(find.source, find.flags.includes('g') ? find.flags : find.flags+'g');
  const matches = typeof pattern === 'string' ? source.split(pattern).length-1 : [...source.matchAll(pattern)].length;
  if (matches !== count) throw incompatible(id);
  const emitted=[];
  const replacement = (...args)=>{
    const value=typeof replace === 'function'?replace(...args):replace;
    if(typeof value!=='string')throw incompatible(id);
    emitted.push(value);return value;
  };
  const output = typeof pattern === 'string' ? source.replaceAll(pattern,replacement) : source.replace(pattern,replacement);
  if(emitted.some(value=>value&&!output.includes(value)))throw incompatible(id);
  if(emitted.every(value=>value==='')&&(typeof pattern==='string'?output.includes(pattern):new RegExp(pattern.source,pattern.flags).test(output)))throw incompatible(id);
  return {source:output,report:{id,status:'applied',matches,expected:count}};
}
function classBody(source,name,transform) {
  const marker=`Class((function ${name}(`;
  if (source.split(marker).length !== 2) throw incompatible(`class.${name}`);
  const start=source.indexOf(marker), next=source.indexOf('Class((function ',start+marker.length),end=next<0?source.length:next;
  return source.slice(0,start)+transform(source.slice(start,end))+source.slice(end);
}
module.exports={exactReplace,classBody,incompatible};
