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
  assert.equal(operations.length,1);
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
