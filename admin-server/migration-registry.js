const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
// Frozen catalog signatures measured on isolated PostgreSQL 18; 002 changes data only.
const historicalSignature = 'd707b879563d88ac731f0e95982187542f1d260bec0ad866110bc3f155f90534';
const schemaSignature = '0b4bc29585cf5c4e05aa6ec8084386cef40e0178c7a358b8210abfb30d917c8c';
const signatures = [historicalSignature,historicalSignature,schemaSignature];
const files = ['001-initial.sql','002-site-identity.sql','003-engine-delivery.sql'];
const migrations = Object.freeze(files.map((file,index)=>{
  const sql = readFileSync(join(__dirname,'migrations',file),'utf8');
  return Object.freeze({version:index+1,file,sql,
    checksum:createHash('sha256').update(sql).digest('hex'),schemaSignature:signatures[index]});
}));
if (migrations[0].checksum !== 'bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15')
  throw Error('Initial migration must not change');
if (migrations[1].checksum !== '98fca286a9790bff1b10a74719c820f15e3d66b5054c459f87057b34151c7533')
  throw Error('Site identity migration must not change');
module.exports = {migrations,currentSchemaVersion:migrations.at(-1).version,
  checksum:migrations[0].checksum,schemaSignature};
