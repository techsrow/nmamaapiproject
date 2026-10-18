const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
(async()=>{const db=new PGlite();try{
await db.exec(`CREATE TABLE "NavigationMenu" (id serial PRIMARY KEY,name text NOT NULL UNIQUE,handle text NOT NULL UNIQUE,items jsonb NOT NULL,"isActive" boolean NOT NULL DEFAULT true,"createdAt" timestamp NOT NULL DEFAULT now(),"updatedAt" timestamp NOT NULL DEFAULT now()); INSERT INTO "NavigationMenu" (name,handle,items) VALUES ('Legacy menu','legacy','[]');`);
await db.exec(fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261016110000_navigation_locations/migration.sql'),'utf8'));
assert.deepEqual((await db.query('SELECT locations FROM "NavigationMenu" WHERE handle=$1',['legacy'])).rows[0].locations,[]);
await db.query('UPDATE "NavigationMenu" SET locations=$1 WHERE handle=$2',[['header','mobile'],'legacy']);
assert.equal((await db.query('SELECT handle FROM "NavigationMenu" WHERE $1=ANY(locations)',['header'])).rows[0].handle,'legacy');
assert.equal((await db.query('SELECT count(*)::int AS count FROM "NavigationMenu"')).rows[0].count,1);
console.log('3 navigation PostgreSQL migration checks passed; embedded single connection.');
}finally{await db.close()}})().catch(e=>{console.error(e);process.exitCode=1});
