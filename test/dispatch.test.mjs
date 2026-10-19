import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {dispatchPublicTestCompute} from '../src/dispatch.mjs';
import {application} from '../src/application.mjs';
import {WORKFLOW_COMMIT,WORKFLOW_GIT_BLOB,WORKFLOW_REF,WORKFLOW_RELEASE_ID, WORKFLOW_SHA256} from '../src/admission.mjs';

const sha256Hex = value => createHash('sha256').update(value).digest('hex');
const request = Object.freeze({ targetRepository:'public/target',targetCommit:'a'.repeat(40) });
const workflowBytes = await readFile(new URL('../content/workflows/bounded-public-test.yml',import.meta.url));
assert.equal(sha256Hex(workflowBytes),WORKFLOW_SHA256,'checked-in immutable workflow bytes must match original trusted source');

function githubFixture(overrides={}) {
  const calls=[];
  const port={
    async getRepo(repo){calls.push('getRepo:'+repo);return {visibility:'public'};},
    async getActionsPermissions(repo){calls.push('permissions:'+repo);return {enabled:true};},
    async getCommit(repo,commit){calls.push('commit:'+repo);return {sha:commit};},
    async getTagRef(repo,ref){calls.push('tag:'+repo);return {object:{type:'commit',sha:WORKFLOW_COMMIT}};},
    async getContentRecord(repo,commit,path){calls.push('workflow:'+repo);return {encoding:'base64',content:workflowBytes.toString('base64'),type:'file',sha:WORKFLOW_GIT_BLOB};},
    async getReleaseByTag(repo,ref){calls.push('release:'+repo);return {id:WORKFLOW_RELEASE_ID,tag_name:WORKFLOW_REF,draft:false,immutable:true};},
    async dispatchWorkflow(repo,name,ref,body){calls.push('dispatch');return {repo,name,ref,body};},
    ...overrides,
  };
  return {port,calls};
}
const fixtures = Object.freeze({sha256Hex,environment:{}});

test('one native dispatch runs exactly one admitted original public workflow',async()=>{
  const {port,calls}=githubFixture();
  const result=await dispatchPublicTestCompute(request,{...fixtures,github:port});
  assert.equal(calls.filter(x=>x==='dispatch').length,1);
  assert.deepEqual(result,{
    type:'GitHubPublicTestComputeDispatchAccepted',runnerRepository:'emsenn/union-free-compute-runner',
    targetRepository:'public/target',targetCommit:'a'.repeat(40),patchBytes:0,
    workflowRef:WORKFLOW_REF,workflowCommit:WORKFLOW_COMMIT,workflowSha256:WORKFLOW_SHA256,
    workflowReleaseId:WORKFLOW_RELEASE_ID,runner:'ubuntu-latest',timeoutMinutes:15,
  });
});

test('a second valid immutable target with a bounded patch uses identical owner checks',async()=>{
  const {port,calls}=githubFixture();const patch=Buffer.from('diff --git a/a b/a\n');
  const result=await dispatchPublicTestCompute({targetRepository:'other/project',targetCommit:'b'.repeat(40),patchBase64:patch.toString('base64')},{...fixtures,github:port});
  assert.equal(result.patchBytes,patch.length);assert.equal(result.targetRepository,'other/project');
  assert.equal(calls.filter(x=>x==='dispatch').length,1);
});

test('native MetroPlat application installs same producer; no caller-controlled host/provider overrides',async()=>{
  assert.equal(application.kind,'metroplat.application/v1');
  const f=githubFixture();const calls=[];
  const operations=application.operations(null,{dispatch:async(input,options)=>{
    calls.push({input,environment:options.environment});
    return dispatchPublicTestCompute(input,{...fixtures,github:f.port});
  },environment:{GITHUB_PUBLIC_COMPUTE_REPO:'emsenn/union-free-compute-runner'}});
  assert.equal(operations.length,2);
  assert.equal(operations[0].verb,'public-test-compute-dispatch');
  assert.equal(operations[0].effects.replay,'coordinated');
  const result=await operations[0].execute(request);
  assert.equal(result.targetRepository,request.targetRepository);
  assert.equal(calls.length,1);
  assert.equal(f.calls.filter(x=>x==='dispatch').length,1);
  assert.throws(()=>application.operations(null,{configuration:{runnerRepository:'attacker/host'}}),/overrides/u);
});

test('malformed, private or mutable requests refuse without external effects',async()=>{
  const forbidden=[
    {targetRepository:'public/target',targetCommit:'main'},
    {targetRepository:'private project',targetCommit:'a'.repeat(40)},
    {...request,runnerRepository:'evil/source'},
    {...request,patchBase64:'not base64!!'},
    {...request,patchBase64:'a'.repeat(65540)},
  ];
  for(const input of forbidden){const {port,calls}=githubFixture();await assert.rejects(()=>dispatchPublicTestCompute(input,{...fixtures,github:port}));assert.deepEqual(calls,[])}
  const {port,calls}=githubFixture({getRepo:async repo=>({visibility:repo==='public/target'?'private':'public'})});
  await assert.rejects(()=>dispatchPublicTestCompute(request,{...fixtures,github:port}),/target-not-public/u);
  assert.equal(calls.includes('dispatch'),false);
});

test('tampered local bytes or remote bytes refuse before dispatch',async()=>{
  const f=githubFixture();
  const local=async (path,encoding)=>path.endsWith('bounded-public-test.yml')?Buffer.from('wrong'):readFile(path,encoding);
  await assert.rejects(()=>dispatchPublicTestCompute(request,{...fixtures,github:f.port,read:local}),/local public-compute workflow binding/u);
  assert.deepEqual(f.calls,[]);
  const g=githubFixture({getContentRecord:async()=>({encoding:'base64',content:Buffer.from('wrong').toString('base64'),type:'file',sha:WORKFLOW_GIT_BLOB})});
  await assert.rejects(()=>dispatchPublicTestCompute(request,{...fixtures,github:g.port}),/workflow tag or bytes drifted/u);
  assert.equal(g.calls.includes('dispatch'),false);
});

test('uncertain acknowledgement fails closed, without retry or false receipt',async()=>{
  let attempts=0;
  const f=githubFixture({dispatchWorkflow:async()=>{attempts++;throw new Error('unknown provider acknowledgement')}});
  await assert.rejects(()=>dispatchPublicTestCompute(request,{...fixtures,github:f.port}),/unknown provider acknowledgement/u);
  assert.equal(attempts,1);
});

test('native world can read actual queued, completed and failed workflow results from the original provider',async()=>{
  const {observePublicTestComputeRuns}=await import('../src/dispatch.mjs');
  const calls=[];
  const github={
    async getRepo(r){calls.push(['repo',r]);return {visibility:'public'};},
    async listRuns(r,w,n){calls.push(['runs',r,w,n]);return [
      {id:11,status:'queued',conclusion:null,createdAt:'2026-10-18T20:00:00Z',displayTitle:'public test a/b@ab'},
      {id:12,status:'completed',conclusion:'success',createdAt:'2026-10-18T20:01:00Z',displayTitle:'public test a/c@cd'},
      {id:13,status:'completed',conclusion:'failure',createdAt:'2026-10-18T20:02:00Z',displayTitle:'public test a/d@ef'},
    ];},
  };
  const result=await observePublicTestComputeRuns({}, {environment:{},github});
  assert.equal(result.type,'GitHubPublicTestComputeRunsObserved');
  assert.equal(result.runs.length,3);
  assert.equal(result.runs[0].status,'queued');
  assert.equal(result.runs[0].conclusion,null);
  assert.equal(result.runs[1].conclusion,'success');
  assert.equal(result.runs[2].conclusion,'failure');
  assert.deepEqual(calls[1],['runs','emsenn/union-free-compute-runner','bounded-public-test.yml',20]);
  const operations=application.operations(null, {observeRuns:async(input,ports)=>observePublicTestComputeRuns(input,{...ports,github})});
  assert.equal(operations[1].verb,'public-test-compute-runs');
  assert.equal(operations[1].effects.replay,'safe');
  assert.equal((await operations[1].execute({})).runs.length,3);
});

test('run reading rejects caller-chosen sources, private runners and malformed provider values',async()=>{
  const {observePublicTestComputeRuns}=await import('../src/dispatch.mjs');
  let calls=0;
  const github={getRepo:async()=>{calls++;return {visibility:'public'};},listRuns:async()=>{calls++;return [];}};
  await assert.rejects(()=>observePublicTestComputeRuns({runnerRepository:'arbitrary/private'},{github,environment:{}}),/no caller-selected/u);
  assert.equal(calls,0);
  await assert.rejects(()=>observePublicTestComputeRuns({}, {github,environment:{GITHUB_PUBLIC_COMPUTE_REPO:'attacker/repo'}}),/may not override/u);
  assert.equal(calls,0);
  await assert.rejects(()=>observePublicTestComputeRuns({}, {github:{getRepo:async()=>({visibility:'private'}),listRuns:async()=>{throw Error('must not list');}},environment:{}}),/original public runner/u);
  await assert.rejects(()=>observePublicTestComputeRuns({}, {github:{getRepo:async()=>({visibility:'public'}),listRuns:async()=>[{id:21,status:null,conclusion:null}]},environment:{}}),/invalid bounded run/u);
});
