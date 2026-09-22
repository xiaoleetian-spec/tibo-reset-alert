import {appendFile,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createGitHubIssueNotifier,fetchXTimeline,initialCloudState,runCloudMonitor,timelineFromFixture} from './cloud-monitor-lib.mjs';

const args=new Set(process.argv.slice(2)),value=name=>{const prefix=`${name}=`;return process.argv.slice(2).find(arg=>arg.startsWith(prefix))?.slice(prefix.length)||null;};
const dryRun=args.has('--dry-run'),fixturePath=value('--fixture'),statePath=value('--state')||'monitor-data/state.json',archivePath=value('--archive')||'monitor-data/archive.jsonl';
async function readJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true});const temp=`${path}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n','utf8');await rename(temp,path);}

const state=await readJson(statePath,initialCloudState());
const timeline=fixturePath?timelineFromFixture(await readJson(fixturePath,null)):await fetchXTimeline({token:process.env.X_BEARER_TOKEN,state});
const notify=dryRun?async alert=>{process.stdout.write(`DRY-RUN alert ${alert.id} ${alert.label}\n`);}:createGitHubIssueNotifier({token:process.env.GH_TOKEN,repository:process.env.GH_REPOSITORY});
const result=await runCloudMonitor({state,timeline,notify});
if(!dryRun&&result.changed){
  await atomicJson(statePath,result.state);
  if(result.archiveRecords.length){await mkdir(dirname(archivePath),{recursive:true});await appendFile(archivePath,result.archiveRecords.map(record=>JSON.stringify(record)).join('\n')+'\n','utf8');}
}
process.stdout.write(JSON.stringify({mode:dryRun?'dry-run':'live',fetched:result.fetched,alerts:result.alerts.map(alert=>({id:alert.id,status:alert.status,severity:alert.severity})),archiveRecords:result.archiveRecords.length,cursor:result.state.lastSeenId,changed:result.changed},null,2)+'\n');
