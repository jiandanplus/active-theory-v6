const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
// Both versions have the exact 001 DDL; 002 changes current identity data only.
const schemaSignature = 'd707b879563d88ac731f0e95982187542f1d260bec0ad866110bc3f155f90534';
const files = ['001-initial.sql','002-site-identity.sql'];
const migrations = Object.freeze(files.map((file,index)=>{
  const sql = readFileSync(join(__dirname,'migrations',file),'utf8');
  return Object.freeze({version:index+1,file,sql,
    checksum:createHash('sha256').update(sql).digest('hex'),schemaSignature});
}));
if (migrations[0].checksum !== 'bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15')
  throw Error('Initial migration must not change');
module.exports = {migrations,currentSchemaVersion:migrations.at(-1).version,
  checksum:migrations[0].checksum,schemaSignature};
